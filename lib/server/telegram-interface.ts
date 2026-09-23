import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  encodeFunctionData,
  formatEther,
  isAddress,
  parseEther,
  zeroAddress,
} from "viem";
import { db } from "@/lib/db";
import { telegramAccounts, telegramConversations } from "@/lib/db/schema";
import {
  cancelMintJob,
  createMintJob,
  getMintJob,
  getUserWallet,
  listMintJobs,
  MintInputError,
  type MintConfiguration,
} from "./mint-job-service";
import {
  consumeTelegramLinkToken,
  resolveTelegramUser,
} from "./telegram-link-service";
import { parseTelegramStartToken } from "./telegram-webhook";
import type {
  MintDraft,
  TelegramButton,
  TelegramInput,
  TelegramReply,
} from "./telegram-types";
import type { DatabaseTransaction } from "./transaction-engine/guards";

const DRAFT_TTL = 30 * 60_000;
const button = (text: string, callback_data: string): TelegramButton => ({
  text,
  callback_data,
});
const reply = (text: string, rows: TelegramButton[][] = []): TelegramReply => ({
  text,
  reply_markup: { inline_keyboard: rows },
});
const menu = [
  [button("New mint", "new"), button("My jobs", "jobs:0")],
  [button("Wallet setup", "wallet"), button("Help", "help")],
];
const network = (chainId: number) =>
  chainId === 8453 ? "Base" : "Base Sepolia";
const draftAction = (draft: MintDraft, action: string) =>
  `d:${draft.id}:${draft.revision}:${action}`;
const dateText = (date: string | Date) =>
  new Date(date).toISOString().replace("T", " ").replace(".000Z", " UTC");
const controls = (draft: MintDraft) => [
  [
    button("Back", draftAction(draft, "back")),
    button("Discard draft", draftAction(draft, "discard")),
  ],
  [button("Restart", "new"), button("Menu", "menu")],
];

export function draftPrompt(draft: MintDraft): TelegramReply {
  const rows = controls(draft);
  const label = `New mint · ${network(draft.chainId)}\n`;
  switch (draft.step) {
    case "contract":
      return reply(
        `${label}Send the NFT contract address (0x…).\nOnly use a contract you trust. Never send a private key or seed phrase.`,
        rows,
      );
    case "method":
      return reply(
        `${label}Choose the contract's mint function. Check its verified ABI; contracts use different methods. Use encoded calldata for other functions or allowlist proofs.`,
        [
          [button("mint(uint256)", draftAction(draft, "quantity"))],
          [button("mint(address,uint256)", draftAction(draft, "recipient"))],
          [button("Encoded calldata", draftAction(draft, "custom"))],
          ...rows,
        ],
      );
    case "quantity":
      return reply(
        `${label}How many NFTs? Send a whole number from 1 to 100.\nThe recipient is your configured burner wallet.`,
        rows,
      );
    case "calldata":
      return reply(
        `${label}Send the encoded mint calldata, beginning with 0x and the function selector (up to 1,800 bytes). Obtain it from the verified contract or mint site. Do not send a private key, seed phrase, or signed transaction.`,
        rows,
      );
    case "value":
      return reply(
        `${label}Send the TOTAL ETH to send to the contract, excluding gas (for example 0.02). For a free mint, send 0. This is the total for all NFTs, not the price per NFT.`,
        rows,
      );
    case "schedule":
      return reply(
        `${label}When should ArmMint try to mint?\nChoose Mint now, or send a UTC timestamp such as 2026-10-01T14:30:00Z. Scheduling is best-effort; gas fees apply and a mint is not guaranteed.`,
        [[button("Mint now", draftAction(draft, "now"))], ...rows],
      );
    case "review":
      return reply(
        `Review mint\nNetwork: ${network(draft.chainId)}\nContract: ${draft.contractAddress}\nWallet: ${draft.walletAddress}\nMethod: ${draft.method === "custom" ? "Custom calldata" : draft.method === "recipient" ? "mint(address,uint256)" : "mint(uint256)"}\n${draft.quantity ? `Quantity: ${draft.quantity}\n` : "Quantity/proofs: encoded in calldata\n"}Call selector: ${draft.calldata?.slice(0, 10)}\nCall size: ${((draft.calldata?.length ?? 2) - 2) / 2} bytes\nTotal value: ${formatEther(BigInt(draft.valueWei ?? "0"))} ETH + gas\nWhen: ${draft.scheduledFor === "now" ? "As soon as the worker is available" : dateText(draft.scheduledFor!)}\n\nConfirm only if these details match the mint you intend. Simulation runs before signing; a submitted transaction cannot be cancelled here.`,
        [[button("Confirm mint", draftAction(draft, "confirm"))], ...rows],
      );
  }
}

function encodeMint(draft: MintDraft) {
  const recipient = draft.method === "recipient";
  return encodeFunctionData({
    abi: [
      {
        type: "function",
        name: "mint",
        stateMutability: "payable",
        inputs: recipient
          ? [
              { name: "to", type: "address" },
              { name: "quantity", type: "uint256" },
            ]
          : [{ name: "quantity", type: "uint256" }],
        outputs: [],
      },
    ],
    functionName: "mint",
    args: recipient
      ? [draft.walletAddress, BigInt(draft.quantity!)]
      : [BigInt(draft.quantity!)],
  });
}
function back(draft: MintDraft) {
  const steps: Record<MintDraft["step"], MintDraft["step"]> = {
    contract: "contract",
    method: "contract",
    quantity: "method",
    calldata: "method",
    value: draft.method === "custom" ? "calldata" : "quantity",
    schedule: "value",
    review: "schedule",
  };
  draft.step = steps[draft.step];
}
// Reject likely secrets before routing typed input, and never echo rejected text.
export function looksSensitive(text: string) {
  return (
    /(?:^|\s)(?:0x)?[a-fA-F0-9]{64}(?:$|\s)/.test(text) ||
    /^(?:[a-z]+\s+){11,23}[a-z]+$/i.test(text.trim())
  );
}
export type TelegramInterfaceConfig = { appUrl: string; chainId: number };

async function showJob(
  userId: string,
  id: string,
  tx: DatabaseTransaction,
): Promise<TelegramReply> {
  const record = await getMintJob(userId, id, tx);
  if (!record) return reply("Job not found in your account.", menu);
  const { job, history } = record;
  const labels: Record<string, string> = {
    SCHEDULED: "Scheduled — waiting for its start time",
    CLAIMED: "Worker is preparing your mint",
    SIMULATING: "Checking whether the mint can execute",
    SIGNING: "Signing with your burner wallet",
    SUBMITTING: "Submitting to the network",
    SUBMITTED: "Submitted — awaiting confirmation",
    CONFIRMING: "Awaiting enough confirmations",
    RETRYING: "Retrying / checking the previous submission",
    SUCCEEDED: "Mint transaction confirmed",
    FAILED: "Mint failed or reverted",
    CANCELLED: "Cancelled before execution",
  };
  const rows: TelegramButton[][] = [
    [button("Refresh", `job:${id}`), button("My jobs", "jobs:0")],
  ];
  if (job.state === "SCHEDULED")
    rows.push([button("Cancel job", `cancel:${id}`)]);
  const confirmed =
    history.find((t) => t.state === "CONFIRMED" || t.state === "REVERTED") ??
    history[0];
  if (confirmed?.hash && /^0x[a-fA-F0-9]{64}$/.test(confirmed.hash))
    rows.push([
      {
        text: "View transaction",
        url: `https://${job.chainId === 84532 ? "sepolia." : ""}basescan.org/tx/${confirmed.hash}`,
      },
    ]);
  return reply(
    `Mint job ${job.id}\nStatus: ${labels[job.state]}\nNetwork: ${network(job.chainId)}\nContract: ${job.contractAddress}\nValue: ${formatEther(BigInt(job.valueWei))} ETH + gas\nScheduled: ${dateText(job.scheduledFor)}${confirmed?.hash ? `\nTransaction: ${confirmed.hash}` : ""}\n\n${job.state === "SCHEDULED" ? "Cancellation is available until the worker claims this job." : "Execution has started or ended; cancellation is unavailable."}`,
    rows,
  );
}

export async function handleTelegramInput(
  input: TelegramInput,
  config: TelegramInterfaceConfig,
  now = new Date(),
): Promise<TelegramReply | null> {
  const appUrl = new URL("/", config.appUrl).toString();
  const setup = [[{ text: "Open secure ArmMint setup", url: appUrl }]];
  const token = parseTelegramStartToken(input.text);
  if (token) {
    const result = await consumeTelegramLinkToken(token, input.identity, now);
    if (
      result.status === "invalid_token" &&
      (await resolveTelegramUser(input.identity.id))
    ) {
      return reply(
        "Your Telegram account is already linked to ArmMint. This link was not applied again. Choose an action below.",
        menu,
      );
    }
    return result.status === "linked"
      ? reply(
          "Telegram linked successfully.\nArmMint uses your dedicated burner wallet to simulate, sign, and submit the mint jobs you confirm. Set up your wallet securely, then create a mint.",
          menu,
        )
      : reply(
          result.status === "invalid_token"
            ? "This link is invalid or expired. If you already linked, use /start. Otherwise generate a new link in ArmMint."
            : "This Telegram or ArmMint account is already linked to a different account.",
          setup,
        );
  }
  return db.transaction(async (tx) => {
    // Serialize per linked account across processes. Identity is always from the
    // verified update; callback data can never choose an ArmMint user.
    const [account] = await tx
      .select()
      .from(telegramAccounts)
      .where(eq(telegramAccounts.telegramUserId, input.identity.id))
      .for("update");
    if (!account)
      return reply(
        "Welcome to ArmMint.\n1. Sign in to ArmMint on the web.\n2. Link Telegram from your account.\n3. Set up a dedicated burner wallet there, then return here to create and track mints.\n\nNever send private keys or seed phrases in chat.",
        setup,
      );
    const [conversation] = await tx
      .select()
      .from(telegramConversations)
      .where(eq(telegramConversations.userId, account.userId));
    // Telegram may pick a new update-ID sequence after a week without updates.
    if (
      conversation &&
      conversation.updatedAt.getTime() > now.getTime() - 7 * 86400_000 &&
      input.updateId <= conversation.lastUpdateId
    )
      return null;
    let draft =
      conversation && conversation.expiresAt > now ? conversation.draft : null;
    const save = async (response: TelegramReply) => {
      await tx
        .insert(telegramConversations)
        .values({
          userId: account.userId,
          draft,
          lastUpdateId: input.updateId,
          expiresAt: new Date(now.getTime() + DRAFT_TTL),
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: telegramConversations.userId,
          set: {
            draft,
            lastUpdateId: input.updateId,
            expiresAt: new Date(now.getTime() + DRAFT_TTL),
            updatedAt: now,
          },
        });
      return response;
    };
    const text = input.text?.trim() ?? "";
    if (looksSensitive(text))
      return save(
        reply(
          "Do not send private keys or seed phrases to Telegram. This input was not saved. If it was a real secret, consider that wallet exposed and move its assets to a new wallet. Use secure web setup for keys.",
          setup,
        ),
      );
    const command = text.match(/^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/);
    const action =
      input.callback?.data ??
      (command
        ? ((
            {
              start: "menu",
              help: "help",
              mint: "new",
              new: "new",
              jobs: "jobs:0",
              wallet: "wallet",
              cancel: command[2] ? `cancel:${command[2]}` : "discard",
              back: "back",
              status: command[2] ? `job:${command[2]}` : "jobs:0",
            } as Record<string, string>
          )[command[1].toLowerCase()] ?? "unknown")
        : "text");
    if (action === "menu" || action === "help")
      return save(
        reply(
          "ArmMint\nCreate a mint, review its contract and total ETH value, then confirm. The worker checks the call before signing and tracks the transaction. Use a dedicated burner wallet with enough ETH for the mint and gas.\n\n/mint — new mint\n/jobs — your jobs and status\n/wallet — secure wallet setup\n/cancel — discard the current draft\n/back — previous step\n/start — menu\n\nDrafts expire after 30 minutes. Starting a new mint replaces the current draft. Never send keys or seed phrases here.",
          draft ? [[button("Resume draft", "resume")], ...menu] : menu,
        ),
      );
    if (action === "unknown")
      return save(
        reply("Unknown command. Use /help or choose an action below.", menu),
      );
    if (action === "wallet") {
      const wallet = await getUserWallet(account.userId, tx);
      return save(
        reply(
          wallet
            ? `Your burner wallet: ${wallet.address}\nManage setup on the authenticated ArmMint web app. Never send keys here.`
            : "Set up a dedicated burner wallet in the authenticated ArmMint web app, then return and choose New mint.",
          [...setup, ...menu],
        ),
      );
    }
    if (/^jobs:\d{1,6}$/.test(action)) {
      const requested = Number(action.split(":")[1]);
      const page = Math.min(requested, 200);
      const jobs = await listMintJobs(account.userId, page, tx);
      const rows = jobs
        .slice(0, 5)
        .map((job) => [
          button(
            `${job.state} · ${job.contractAddress.slice(0, 8)}… · ${job.id.slice(0, 8)}`,
            `job:${job.id}`,
          ),
        ]);
      if (page > 0) rows.push([button("Previous", `jobs:${page - 1}`)]);
      if (jobs.length > 5) rows.push([button("Next", `jobs:${page + 1}`)]);
      return save(
        reply(
          jobs.length
            ? `Your mint jobs · page ${page + 1}\nChoose a job for details and current status.`
            : "No mint jobs on this page. Create your first mint below.",
          [...rows, ...menu],
        ),
      );
    }
    const jobAction = action.match(/^(job|cancel|stop):([a-f0-9-]{36})$/);
    if (jobAction) {
      const [, kind, id] = jobAction;
      if (kind === "job") return save(await showJob(account.userId, id, tx));
      if (kind === "cancel") {
        const record = await getMintJob(account.userId, id, tx);
        if (!record) return save(reply("Job not found in your account.", menu));
        if (record.job.state !== "SCHEDULED")
          return save(
            reply(
              "This job can no longer be cancelled. The worker has started or the job has ended.",
              [[button("View status", `job:${id}`)]],
            ),
          );
        return save(
          reply(
            `Cancel mint job ${id}?\nThis will stop the scheduled mint only if execution has not started.`,
            [
              [
                button("Yes, cancel job", `stop:${id}`),
                button("Keep job", `job:${id}`),
              ],
            ],
          ),
        );
      }
      const result = await cancelMintJob(account.userId, id, now, tx);
      return save(
        reply(
          result === "cancelled"
            ? "Mint job cancelled successfully."
            : result === "not_found"
              ? "Job not found in your account."
              : "Unable to cancel: execution has already started. Check its current status.",
          [[button("My jobs", "jobs:0")]],
        ),
      );
    }
    if (action === "new") {
      const wallet = await getUserWallet(account.userId, tx);
      if (!wallet || !isAddress(wallet.address))
        return save(
          reply(
            "Set up a valid burner wallet in ArmMint before creating a mint.",
            setup,
          ),
        );
      draft = {
        id: randomUUID(),
        revision: 0,
        step: "contract",
        chainId: config.chainId,
        walletAddress: wallet.address,
      };
      return save(draftPrompt(draft));
    }
    if (action === "discard") {
      draft = null;
      return save(
        reply("Draft discarded. Existing mint jobs are unchanged.", menu),
      );
    }
    if (!draft)
      return save(
        reply(
          "No active mint draft. It may have expired or already been confirmed. Choose New mint or check My jobs.",
          menu,
        ),
      );
    if (action === "resume") return save(draftPrompt(draft));
    let choice =
      input.callback && !action.startsWith("d:") ? "invalid" : action;
    if (action.startsWith("d:")) {
      const [, id, revision, operation] = action.split(":");
      if (id !== draft.id || revision !== String(draft.revision))
        return save(
          reply(
            "That button belongs to an older step. Resume your current draft below.",
            [[button("Resume draft", "resume")], ...menu],
          ),
        );
      choice = operation;
    }
    if (choice === "discard") {
      draft = null;
      return save(reply("Draft discarded.", menu));
    }
    if (choice === "back") {
      back(draft);
      draft.revision++;
      return save(draftPrompt(draft));
    }
    try {
      if (choice === "confirm" && draft.step === "review") {
        const wallet = await getUserWallet(account.userId, tx);
        if (!wallet || wallet.address !== draft.walletAddress)
          throw new MintInputError(
            "Your wallet changed. Start a new mint to review it.",
          );
        if (draft.chainId !== config.chainId)
          throw new MintInputError(
            "The supported network changed. Start a new mint.",
          );
        const mint: MintConfiguration = {
          chainId: draft.chainId,
          contractAddress: draft.contractAddress!,
          calldata: draft.calldata!,
          valueWei: draft.valueWei!,
          scheduledFor:
            draft.scheduledFor === "now"
              ? now.toISOString()
              : draft.scheduledFor!,
        };
        const job = await createMintJob(
          account.userId,
          mint,
          `telegram:${account.userId}:${draft.id}`,
          now,
          tx,
        );
        draft = null;
        return save(
          reply(
            `Mint created successfully.\nJob: ${job.id}\nNetwork: ${network(job.chainId)}\nScheduled: ${dateText(job.scheduledFor)}\nThe worker will simulate before signing.`,
            [[button("View job", `job:${job.id}`)], ...menu],
          ),
        );
      }
      if (
        draft.step === "method" &&
        ["quantity", "recipient", "custom"].includes(choice)
      ) {
        draft.method = choice as MintDraft["method"];
        draft.quantity = undefined;
        draft.calldata = undefined;
        draft.step = choice === "custom" ? "calldata" : "quantity";
      } else if (draft.step === "schedule" && choice === "now") {
        draft.scheduledFor = "now";
        draft.step = "review";
      } else if (choice === "text" && text) {
        switch (draft.step) {
          case "contract":
            if (!isAddress(text) || text.toLowerCase() === zeroAddress)
              throw new MintInputError(
                "Enter a valid, non-zero contract address beginning with 0x.",
              );
            draft.contractAddress = text;
            draft.step = "method";
            break;
          case "quantity":
            if (!/^[1-9][0-9]{0,2}$/.test(text) || Number(text) > 100)
              throw new MintInputError(
                "Quantity must be a whole number from 1 to 100.",
              );
            draft.quantity = Number(text);
            draft.calldata = encodeMint(draft);
            draft.step = "value";
            break;
          case "calldata":
            if (
              !/^0x(?:[a-fA-F0-9]{2}){4,1800}$/.test(text) ||
              text.length === 66
            )
              throw new MintInputError(
                "Enter valid encoded calldata (4 to 1,800 bytes). Never send a private key or signed transaction.",
              );
            draft.calldata = text;
            draft.step = "value";
            break;
          case "value":
            if (
              !/^(0|[1-9][0-9]{0,59})(?:\.[0-9]{1,18})?$/.test(text) ||
              parseEther(text) >= 2n ** 256n
            )
              throw new MintInputError(
                "Enter a non-negative ETH amount with at most 18 decimal places, such as 0.02.",
              );
            draft.valueWei = parseEther(text).toString();
            draft.step = "schedule";
            break;
          case "schedule": {
            const time = new Date(text);
            if (
              !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(text) ||
              !Number.isFinite(time.getTime()) ||
              time.toISOString() !== text.replace("Z", ".000Z") ||
              time <= now ||
              time.getTime() > now.getTime() + 365 * 86400_000
            )
              throw new MintInputError(
                "Use a future UTC time within one year: YYYY-MM-DDTHH:MM:SSZ, or choose Mint now.",
              );
            draft.scheduledFor = time.toISOString();
            draft.step = "review";
            break;
          }
          default:
            return save(draftPrompt(draft));
        }
      } else return save(draftPrompt(draft));
      draft.revision++;
      return save(draftPrompt(draft));
    } catch (error) {
      if (!(error instanceof MintInputError) || !draft) throw error;
      return save(
        reply(
          `${error.message}\n\n${draftPrompt(draft).text}`,
          draftPrompt(draft).reply_markup?.inline_keyboard,
        ),
      );
    }
  });
}
