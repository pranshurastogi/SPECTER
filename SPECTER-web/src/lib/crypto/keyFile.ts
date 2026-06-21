import type { GenerateKeysResponse } from "@/lib/api";

const REQUIRED_FIELDS = [
  "spending_pk",
  "spending_sk",
  "viewing_pk",
  "viewing_sk",
  "meta_address",
] as const;

/**
 * Parse and validate a `specter-keys.json` backup.
 * Throws an Error with a user-facing message if the file is not valid JSON
 * or is missing any required key field. Returns only the five key fields.
 */
export function parseKeyFile(text: string): GenerateKeysResponse {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid file — not valid JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid file — expected a key backup object");
  }

  for (const field of REQUIRED_FIELDS) {
    const value = parsed[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`Invalid file — ${field} missing or empty`);
    }
  }

  return {
    spending_pk: parsed.spending_pk as string,
    spending_sk: parsed.spending_sk as string,
    viewing_pk: parsed.viewing_pk as string,
    viewing_sk: parsed.viewing_sk as string,
    meta_address: parsed.meta_address as string,
  };
}
