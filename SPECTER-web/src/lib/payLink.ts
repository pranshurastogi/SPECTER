import type { TxChain } from "@/lib/blockchain/sendChains";

/** Origin used when generating shareable absolute URLs. */
export const PAY_ORIGIN =
  (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env?.VITE_PAY_ORIGIN) ||
  "https://specterpq.com";

const VALID_CHAINS: ReadonlySet<string> = new Set(["ethereum", "arbitrum", "monad", "sui"]);
const LABEL_MAX = 80;
const MEMO_MAX = 140;
const REF_MAX = 40;

export interface PayLinkParams {
  amount?: string;
  chain?: TxChain;
  label?: string;
  memo?: string;
  ref?: string;
}

export interface PayLinkConfig extends PayLinkParams {
  recipient: string;
}

/** True for ENS (.eth) or SuiNS (.sui) names. Rejects junk/path traversal. */
export function isValidRecipientName(name: string): boolean {
  const n = (name || "").trim().toLowerCase();
  return /^([a-z0-9]+(-[a-z0-9]+)*\.)+(eth|sui)$/.test(n);
}

function isValidAmount(value: string): boolean {
  if (!/^\d+(\.\d+)?$/.test(value)) return false;
  return Number(value) > 0;
}

/** Build the relative path + query string for a pay link. Params are emitted in a stable order. */
export function buildPayPath(recipient: string, params: PayLinkParams = {}): string {
  const qs = new URLSearchParams();
  if (params.amount) qs.set("amount", params.amount);
  if (params.chain) qs.set("chain", params.chain);
  if (params.label) qs.set("label", params.label);
  if (params.memo) qs.set("memo", params.memo);
  if (params.ref) qs.set("ref", params.ref);
  const query = qs.toString();
  return `/pay/${encodeURIComponent(recipient)}${query ? `?${query}` : ""}`;
}

/** Absolute shareable URL. */
export function buildPayUrl(recipient: string, params: PayLinkParams = {}, origin: string = PAY_ORIGIN): string {
  return `${origin.replace(/\/$/, "")}${buildPayPath(recipient, params)}`;
}

/** Parse + validate query params from a pay link. Invalid values are dropped. */
export function parsePayParams(search: URLSearchParams | string): PayLinkParams {
  const sp = typeof search === "string" ? new URLSearchParams(search) : search;
  const out: PayLinkParams = {};

  const amount = sp.get("amount");
  if (amount && isValidAmount(amount)) out.amount = amount;

  const chain = sp.get("chain");
  if (chain && VALID_CHAINS.has(chain)) out.chain = chain as TxChain;

  const label = sp.get("label");
  if (label) out.label = label.replace(/[\r\n]+/g, " ").slice(0, LABEL_MAX).trimEnd();

  const memo = sp.get("memo");
  if (memo) out.memo = memo.replace(/[\r\n]+/g, " ").slice(0, MEMO_MAX).trimEnd();

  const ref = sp.get("ref");
  if (ref) out.ref = ref.replace(/[\r\n]+/g, " ").slice(0, REF_MAX).trimEnd();

  return out;
}
