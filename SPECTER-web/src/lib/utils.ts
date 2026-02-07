import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatAddress(address: string | undefined): string {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** Format crypto amount with max 8 decimals; show "0" for dust. */
export function formatCryptoAmount(amount: number | string): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(n)) return "0";
  const fixed = n.toFixed(8);
  const parsed = parseFloat(fixed);
  if (parsed === 0) return "0";
  return parsed.toString();
}
