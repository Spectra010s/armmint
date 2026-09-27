"use client";
import { useState } from "react";
import { parseUnits, formatUnits } from "viem";
import { MINT_NETWORKS, getNetwork, networkName, nativeSymbol } from "@/lib/networks";

type Draft = { chainId: number; contractAddress: string; calldata: string; valueWei: string; scheduledFor: string; idempotencyKey: string };
export function MintJobForm() {
  const [chainId, setChainId] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [previous, setPrevious] = useState<Draft | null>(null);
  const [scheduledInput, setScheduledInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  async function create() {
    if (!draft || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/mint-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const result = await response.json();
      if (!response.ok) { setError(response.status === 401 ? "Sign in again to create a mint." : "Unable to create mint. Check your wallet setup, network, contract, calldata and schedule, then try again."); return; }
      if (typeof result.id !== "string" || !/^[a-f0-9-]{36}$/.test(result.id)) throw new Error();
      setCreated(result.id);
    } catch { setError("Unable to reach ArmMint. Retry uses the same request to avoid duplicate jobs."); }
    finally { setBusy(false); }
  }
  if (created) return <output>Mint scheduled. <a className="underline" href={`/dashboard/jobs/${created}`}>View job and status</a></output>;
  return <section className="mt-6 space-y-4">
    {draft ? <div className="space-y-3 rounded-xl border border-white/20 p-5">
      <h2 className="text-xl font-semibold">Review mint</h2>
      <p>Network: {networkName(draft.chainId)}</p>
      <p className="break-all">Contract: {draft.contractAddress}</p>
      <p className="break-all">Calldata: {draft.calldata}</p>
      <p>Total: {formatUnits(BigInt(draft.valueWei), 18)} {nativeSymbol(draft.chainId)} + gas</p>
      <p>Scheduled: {draft.scheduledFor}</p>
      <p>Execution uses your configured burner wallet. Submitted transactions cannot be cancelled.</p>
      <button disabled={busy} onClick={create} className="rounded bg-emerald-700 px-4 py-2">{busy ? "Creating…" : "Confirm mint"}</button>{" "}
      <button disabled={busy} onClick={() => { setPrevious(draft); setDraft(null); setError(""); }}>Back to edit</button>
    </div> : <form className="space-y-4" onSubmit={(event) => {
      event.preventDefault(); setError("");
      const form = new FormData(event.currentTarget);
      const network = getNetwork(Number(chainId));
      const value = String(form.get("value") ?? "");
      if (!network || network.legacy || !/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(value)) { setError("Choose a network and enter a valid amount with at most 18 decimal places."); return; }
      try {
        const scheduled = String(form.get("scheduled") ?? "");
        setDraft({ chainId: network.chain.id, contractAddress: String(form.get("contract")).trim(), calldata: String(form.get("calldata")).trim(), valueWei: parseUnits(value, network.chain.nativeCurrency.decimals).toString(), scheduledFor: scheduled ? new Date(scheduled).toISOString() : new Date().toISOString(), idempotencyKey: crypto.randomUUID() });
      } catch { setError("Check the amount and scheduled time."); }
    }}>
      <label className="block">Network<select required value={chainId} onChange={(event) => setChainId(event.target.value)} className="mt-1 block w-full rounded border bg-neutral-900 p-2"><option value="">Choose Arc or Ink</option>{MINT_NETWORKS.map(({ chain }) => <option key={chain.id} value={chain.id}>{chain.name} — {chain.testnet ? "testnet" : "mainnet"} ({chain.nativeCurrency.symbol})</option>)}</select></label>
      <p className="text-sm text-neutral-400">Use a testnet for testing. Your contract and wallet funds must be on the selected network.</p>
      <label className="block">Contract address<input name="contract" defaultValue={previous?.contractAddress} required pattern="0x[0-9a-fA-F]{40}" className="block w-full rounded border bg-neutral-900 p-2" /></label>
      <label className="block">Encoded mint calldata<textarea name="calldata" defaultValue={previous?.calldata} required maxLength={3602} className="block w-full rounded border bg-neutral-900 p-2" /></label>
      <p className="text-sm text-neutral-400">Use the verified contract’s mint selector and arguments. Never enter a private key or seed phrase here.</p>
      <label className="block">Total mint value ({chainId ? nativeSymbol(Number(chainId)) : "native currency"}), excluding gas<input name="value" required defaultValue={previous ? formatUnits(BigInt(previous.valueWei), 18) : "0"} inputMode="decimal" className="block w-full rounded border bg-neutral-900 p-2" /></label>
      <label className="block">Scheduled time (your local time; blank for now)<input name="scheduled" type="datetime-local" value={scheduledInput} onChange={(event) => setScheduledInput(event.target.value)} className="block w-full rounded border bg-neutral-900 p-2" /></label>
      <button className="rounded bg-emerald-700 px-4 py-2">Review mint</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
