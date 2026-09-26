export type MintDraft = {
  id: string;
  revision: number;
  step:
    | "network"
    | "contract"
    | "method"
    | "quantity"
    | "calldata"
    | "value"
    | "schedule"
    | "review";
  chainId?: number;
  walletAddress: string;
  contractAddress?: string;
  method?: "quantity" | "recipient" | "custom";
  quantity?: number;
  calldata?: string;
  valueWei?: string;
  scheduledFor?: string;
};
export type TelegramButton =
  { text: string; callback_data: string } | { text: string; url: string };
export type TelegramReply = {
  text: string;
  reply_markup?: { inline_keyboard: TelegramButton[][] };
};
export type TelegramInput = {
  updateId: number;
  chatId: number;
  identity: { id: bigint; username: string | null };
  text?: string;
  callback?: { id: string; data: string };
};
