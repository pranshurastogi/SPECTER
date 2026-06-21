# "I already have keys" Load Path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secondary "I already have keys" path to Setup Step 1 so returning users load an existing keypair (from file or saved device vault) and continue to ENS/SuiNS attachment without regenerating.

**Architecture:** A new pure helper validates an uploaded `specter-keys.json`. A new `LoadExistingKeysPanel` component (structural sibling of the existing `EnsExistingRecordPanel`) offers upload + saved-vault loading and returns the full keypair via a callback. `GenerateKeys.tsx` gains one `step1Mode` state that toggles the idle screen between the existing Generate UI and the load panel; a successful load reuses the existing "Keypair confirmed" view.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest (jsdom, globals), Tailwind, framer-motion, lucide-react. Existing modules reused: `@/lib/crypto/keyVault` (`listVaultEntries`, `getEntryUnlockMethod`, `VaultUnlockForm`, `DecryptedKeys`), `@/lib/api` (`GenerateKeysResponse`).

## Global Constraints

- All work is inside `SPECTER-web/`. Run commands from that directory.
- Loaded keys MUST contain all five fields as non-empty strings: `spending_pk`, `spending_sk`, `viewing_pk`, `viewing_sk`, `meta_address`. (Stricter than `EnsExistingRecordPanel`, which checks only `meta_address`.)
- `GenerateKeysResponse` ≡ `DecryptedKeys` (the latter adds only an optional deprecated `view_tag`). Treat loaded keys as `GenerateKeysResponse`.
- Do NOT modify Steps 2–4, the API layer, key types, or persistence. Loading from file does NOT auto-save to the vault.
- On successful load: `setKeys(loaded)`, `setStep1Status("complete")`, `setKeysDownloaded(true)` (suppresses the "haven't downloaded" warning), and a "Keys loaded" toast.
- Match the existing dark theme and the visual patterns already in `EnsExistingRecordPanel` (pick-method cards, dashed drop-zone, back links).
- Test convention: pure logic tested in `src/test/*.ts` with Vitest globals; components are verified via lint + typecheck + build, not unit tests.

---

### Task 1: Key-file parser/validator helper

**Files:**
- Create: `SPECTER-web/src/lib/crypto/keyFile.ts`
- Test: `SPECTER-web/src/test/keyFile.test.ts`

**Interfaces:**
- Consumes: `GenerateKeysResponse` from `@/lib/api`.
- Produces: `parseKeyFile(text: string): GenerateKeysResponse` — parses JSON text, validates all five required string fields are present and non-empty, returns an object containing exactly those five fields. Throws `Error` with a user-facing message on any failure.

- [ ] **Step 1: Write the failing test**

Create `SPECTER-web/src/test/keyFile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseKeyFile } from "@/lib/crypto/keyFile";

const valid = {
  spending_pk: "0xspk",
  spending_sk: "0xssk",
  viewing_pk: "0xvpk",
  viewing_sk: "0xvsk",
  meta_address: "0xmeta",
};

describe("parseKeyFile", () => {
  it("returns the five key fields for a valid file", () => {
    expect(parseKeyFile(JSON.stringify(valid))).toEqual(valid);
  });

  it("strips unknown extra fields", () => {
    const result = parseKeyFile(JSON.stringify({ ...valid, view_tag: 7, junk: "x" }));
    expect(result).toEqual(valid);
    expect(result).not.toHaveProperty("view_tag");
    expect(result).not.toHaveProperty("junk");
  });

  it("throws on non-JSON input", () => {
    expect(() => parseKeyFile("not json")).toThrow(/valid JSON/i);
  });

  it("throws when a required field is missing", () => {
    const { spending_sk, ...rest } = valid;
    expect(() => parseKeyFile(JSON.stringify(rest))).toThrow(/spending_sk/);
  });

  it("throws when a required field is empty", () => {
    expect(() => parseKeyFile(JSON.stringify({ ...valid, meta_address: "" }))).toThrow(/meta_address/);
  });

  it("throws when a required field is not a string", () => {
    expect(() => parseKeyFile(JSON.stringify({ ...valid, viewing_pk: 123 }))).toThrow(/viewing_pk/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd SPECTER-web && npx vitest run src/test/keyFile.test.ts`
Expected: FAIL — cannot resolve `@/lib/crypto/keyFile`.

- [ ] **Step 3: Write minimal implementation**

Create `SPECTER-web/src/lib/crypto/keyFile.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd SPECTER-web && npx vitest run src/test/keyFile.test.ts`
Expected: PASS — 6 tests pass.

- [ ] **Step 5: Commit**

```bash
cd SPECTER-web && git add src/lib/crypto/keyFile.ts src/test/keyFile.test.ts
git commit -m "feat(setup): add specter-keys.json parser/validator helper"
```

---

### Task 2: LoadExistingKeysPanel component

**Files:**
- Create: `SPECTER-web/src/components/features/keys/LoadExistingKeysPanel.tsx`

**Interfaces:**
- Consumes: `parseKeyFile` from `@/lib/crypto/keyFile`; `listVaultEntries`, `getEntryUnlockMethod`, `VaultEntry`, `DecryptedKeys` from `@/lib/crypto/keyVault`; `VaultUnlockForm` from `@/components/features/keys/VaultUnlockForm`; `GenerateKeysResponse` from `@/lib/api`.
- Produces: default-exported React component
  `LoadExistingKeysPanel({ onLoaded, onBack }: { onLoaded: (keys: GenerateKeysResponse) => void; onBack: () => void })`.

- [ ] **Step 1: Create the component**

Create `SPECTER-web/src/components/features/keys/LoadExistingKeysPanel.tsx`. This mirrors the `pick-method | upload | vault` structure of `EnsExistingRecordPanel` (see `src/pages/GenerateKeys.tsx:74-308`), but loads the full keypair instead of comparing a meta-address:

```tsx
import { useRef, useState } from "react";
import { Upload, HardDrive, AlertTriangle } from "lucide-react";
import { parseKeyFile } from "@/lib/crypto/keyFile";
import {
  listVaultEntries,
  getEntryUnlockMethod,
  type VaultEntry,
  type DecryptedKeys,
} from "@/lib/crypto/keyVault";
import { VaultUnlockForm } from "@/components/features/keys/VaultUnlockForm";
import type { GenerateKeysResponse } from "@/lib/api";

type LoadStep = "pick-method" | "upload" | "vault";

function toKeys(d: DecryptedKeys): GenerateKeysResponse {
  return {
    spending_pk: d.spending_pk,
    spending_sk: d.spending_sk,
    viewing_pk: d.viewing_pk,
    viewing_sk: d.viewing_sk,
    meta_address: d.meta_address,
  };
}

export default function LoadExistingKeysPanel({
  onLoaded,
  onBack,
}: {
  onLoaded: (keys: GenerateKeysResponse) => void;
  onBack: () => void;
}) {
  const [step, setStep] = useState<LoadStep>("pick-method");
  const [error, setError] = useState<string | null>(null);
  const [vaultEntries] = useState<VaultEntry[]>(() => listVaultEntries());
  const [selectedEntry, setSelectedEntry] = useState<string>(
    () => listVaultEntries()[0]?.id ?? "",
  );
  const fileRef = useRef<HTMLInputElement>(null);

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      onLoaded(parseKeyFile(text));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read file");
    }
    e.target.value = "";
  };

  return (
    <div className="space-y-3">
      {step === "pick-method" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">How do you have your keys?</p>
          <button
            type="button"
            onClick={() => { setError(null); setStep("upload"); }}
            className="flex items-center gap-3 w-full p-3 rounded-lg border border-border bg-card hover:bg-muted/40 hover:border-primary/30 transition-colors text-left"
          >
            <Upload className="h-4 w-4 text-primary shrink-0" />
            <div>
              <p className="text-xs font-medium text-foreground">Upload key file</p>
              <p className="text-[11px] text-muted-foreground">Load your specter-keys.json backup</p>
            </div>
          </button>
          {vaultEntries.length > 0 ? (
            <button
              type="button"
              onClick={() => { setError(null); setStep("vault"); }}
              className="flex items-center gap-3 w-full p-3 rounded-lg border border-border bg-card hover:bg-muted/40 hover:border-primary/30 transition-colors text-left"
            >
              <HardDrive className="h-4 w-4 text-primary shrink-0" />
              <div>
                <p className="text-xs font-medium text-foreground">Use saved keys</p>
                <p className="text-[11px] text-muted-foreground">
                  {vaultEntries.length} encrypted {vaultEntries.length === 1 ? "entry" : "entries"} on this device
                </p>
              </div>
            </button>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-muted/20 text-muted-foreground">
              <HardDrive className="h-4 w-4 shrink-0 opacity-40" />
              <p className="text-[11px]">No keys saved on this device</p>
            </div>
          )}
          <button
            type="button"
            onClick={onBack}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center pt-1"
          >
            ← Back to generate
          </button>
        </div>
      )}

      {step === "upload" && (
        <div className="space-y-2">
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFileChange} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full flex flex-col items-center gap-2 p-6 rounded-lg border border-dashed border-border hover:border-primary/40 bg-muted/10 hover:bg-muted/20 transition-colors"
          >
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Click to select <span className="font-mono">specter-keys.json</span></span>
          </button>
          {error && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => { setError(null); setStep("pick-method"); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center pt-1"
          >
            ← Back
          </button>
        </div>
      )}

      {step === "vault" && (
        <div className="space-y-2">
          {vaultEntries.length > 1 && (
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">Select key entry:</p>
              {vaultEntries.map((entry) => (
                <label
                  key={entry.id}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                    selectedEntry === entry.id
                      ? "border-primary/40 bg-primary/5"
                      : "border-border bg-card hover:bg-muted/30"
                  }`}
                >
                  <input
                    type="radio"
                    className="accent-primary"
                    checked={selectedEntry === entry.id}
                    onChange={() => setSelectedEntry(entry.id)}
                  />
                  <span className="text-xs font-medium text-foreground truncate">{entry.label}</span>
                  <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
                    {getEntryUnlockMethod(entry) === "passkey" ? "Passkey" : "Password"}
                    {" · "}
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </span>
                </label>
              ))}
            </div>
          )}
          {selectedEntry && (
            <VaultUnlockForm
              entries={vaultEntries}
              selectedId={selectedEntry}
              onSelectId={setSelectedEntry}
              onUnlock={(decrypted) => onLoaded(toKeys(decrypted))}
              unlockLabel="Unlock & load"
              showEntryPicker={false}
            />
          )}
          <button
            type="button"
            onClick={() => { setError(null); setStep("pick-method"); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center pt-1"
          >
            ← Back
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint the new component**

Run: `cd SPECTER-web && npx tsc --noEmit && npx eslint src/components/features/keys/LoadExistingKeysPanel.tsx`
Expected: no type errors, no lint errors.

- [ ] **Step 3: Commit**

```bash
cd SPECTER-web && git add src/components/features/keys/LoadExistingKeysPanel.tsx
git commit -m "feat(setup): add LoadExistingKeysPanel for loading existing keys"
```

---

### Task 3: Wire the load path into Setup Step 1

**Files:**
- Modify: `SPECTER-web/src/pages/GenerateKeys.tsx` (idle-state block at `:316-453` for state/handlers and `:729-741` for the idle UI)

**Interfaces:**
- Consumes: default export `LoadExistingKeysPanel` from `@/components/features/keys/LoadExistingKeysPanel`.
- Produces: no exports; integrates the panel into the page.

- [ ] **Step 1: Import the panel**

In `SPECTER-web/src/pages/GenerateKeys.tsx`, add this import alongside the other `@/components/features/keys` imports (near line 63-66):

```tsx
import LoadExistingKeysPanel from "@/components/features/keys/LoadExistingKeysPanel";
```

- [ ] **Step 2: Add the `step1Mode` state**

Immediately after the `step1Status` state declaration (line 318), add:

```tsx
  const [step1Mode, setStep1Mode] = useState<"generate" | "load">("generate");
```

- [ ] **Step 3: Add the load handler**

Immediately after the `handleGenerate` function (it ends at line 453), add:

```tsx
  const handleLoadExisting = (loaded: GenerateKeysResponse) => {
    setKeys(loaded);
    setStep1Status("complete");
    setKeysDownloaded(true); // user already holds these keys — no download nag
    setEnsUploadResult(null);
    setSuinsUploadResult(null);
    saveSetupProgress({ keysGenerated: true });
    setStep1Mode("generate");
    toast.success("Keys loaded");
  };
```

- [ ] **Step 4: Replace the idle UI block to branch on `step1Mode`**

Replace the entire `{step1Status === "idle" && ( ... )}` block (lines 729-741) with:

```tsx
                    {step1Status === "idle" && step1Mode === "generate" && (
                      <div className="flex flex-col items-center text-center">
                        <div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5">
                          <Key className="h-7 w-7 text-primary" />
                        </div>
                        <p className="text-sm text-muted-foreground mb-6 max-w-sm">
                          Derive your stealth keypair. No one else can trace or see what&apos;s sent to you.
                        </p>
                        <Button variant="quantum" size="lg" onClick={handleGenerate}>
                          Generate Keys
                        </Button>

                        <div className="flex items-center gap-3 w-full my-5">
                          <span className="h-px flex-1 bg-border" />
                          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">or</span>
                          <span className="h-px flex-1 bg-border" />
                        </div>

                        <button
                          type="button"
                          onClick={() => setStep1Mode("load")}
                          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
                        >
                          <HardDrive className="h-3.5 w-3.5" />
                          I already have keys
                        </button>
                      </div>
                    )}

                    {step1Status === "idle" && step1Mode === "load" && (
                      <LoadExistingKeysPanel
                        onLoaded={handleLoadExisting}
                        onBack={() => setStep1Mode("generate")}
                      />
                    )}
```

- [ ] **Step 5: Typecheck, lint, and build**

Run: `cd SPECTER-web && npx tsc --noEmit && npx eslint src/pages/GenerateKeys.tsx && npm run build`
Expected: no type errors, no lint errors, build succeeds.

- [ ] **Step 6: Run the full test suite (no regressions)**

Run: `cd SPECTER-web && npm test`
Expected: all tests pass (including the new `keyFile.test.ts`).

- [ ] **Step 7: Manual verification**

Run: `cd SPECTER-web && npm run dev`, open the Setup page (Step 1 idle). Verify:
- "I already have keys" appears below Generate Keys, under an "or" divider.
- Clicking it shows "Upload key file" and (if vault entries exist) "Use saved keys".
- Uploading a valid `specter-keys.json` lands on the "Keypair confirmed" view showing that file's meta-address; **Continue** goes straight to Step 2 with no download warning.
- Uploading an invalid/incomplete JSON shows an inline error and does not advance.
- "← Back to generate" returns to the unchanged Generate view.

- [ ] **Step 8: Commit**

```bash
cd SPECTER-web && git add src/pages/GenerateKeys.tsx
git commit -m "feat(setup): wire 'I already have keys' load path into Step 1"
```

---

## Notes for the implementer

- `HardDrive` and `Key` are already imported in `GenerateKeys.tsx` (lines 28, 40) — no new lucide import needed there.
- `GenerateKeysResponse` and `toast` are already imported in `GenerateKeys.tsx`.
- Do not touch the `step1Status === "generating"` or `=== "complete"` branches — they are reused unchanged for the loaded-keys case.
- The vault unlock path reuses `VaultUnlockForm` exactly as the ENS panel does; no changes to that component.
