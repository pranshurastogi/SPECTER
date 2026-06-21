# Design — "I already have keys" path in Setup Step 1

**Date:** 2026-06-21
**Area:** `SPECTER-web/src/pages/GenerateKeys.tsx` (Setup flow, Step 1)

## Problem

The Setup Step 1 idle screen offers only **Generate Keys**. A returning user who
generated keys in a past session — but never attached them to ENS/SuiNS — has no
way to pick up where they left off. Their only option is to generate a *new*
keypair, which is wrong (it discards their real identity) and high-friction.

## Goal

Add a secondary **"I already have keys"** path to Step 1 idle. Loading an existing
keypair drops the user onto the existing "Keypair confirmed" view, from which the
unchanged Continue button leads to Step 2 (ENS) → Step 3 (SuiNS) → Step 4. This
lets repeat visitors attach an existing identity to a name service (or simply
re-confirm it) without regenerating.

## Decisions

- **Landing after load:** the existing Step 1 "Keypair confirmed" view (shows the
  loaded meta-address so the user can confirm the right identity; lets them
  re-copy / re-download / re-save). Continue then advances to Step 2 as today.
- **Load methods:** file upload (`specter-keys.json`) **and** saved device keys
  (vault). The saved-keys option only appears when `listVaultEntries()` is
  non-empty.

## Design

### 1. Entry point (Step 1 idle)

Below the existing **Generate Keys** button, add a minimal divider and a
low-emphasis secondary action, consistent with the current dark theme:

```
        [ Generate Keys ]

   ──────────  or  ──────────

      I already have keys
```

Muted-foreground text button with an icon (`Key`/`HardDrive`), hover → primary.
It is visually clearly the secondary path; the generate flow keeps primary weight.

### 2. Load panel (new sub-view)

Clicking "I already have keys" swaps the idle content for a **load panel** that
mirrors the existing `EnsExistingRecordPanel` structure (same look/feel):

- **pick-method:** "Upload key file" (always present) + "Use saved keys" (only
  when vault entries exist; otherwise the disabled "No keys saved on this device"
  hint, matching the ENS panel).
- **upload:** dashed drop-zone → reads the selected JSON, validates that **all
  five** fields are present and are strings: `spending_pk`, `spending_sk`,
  `viewing_pk`, `viewing_sk`, `meta_address`. This is stricter than
  `EnsExistingRecordPanel` (which only checks `meta_address`) because loaded keys
  must be usable for scanning, which needs the secret keys. On invalid/unreadable
  file, show the same inline error treatment as the ENS panel.
- **vault:** reuse `VaultUnlockForm` (with entry picker when more than one entry)
  → yields full `DecryptedKeys`.
- A "← Back to generate" link returns to the idle Generate view.

### 3. On successful load

Both paths produce the full keypair (`GenerateKeysResponse` ≡ `DecryptedKeys`,
modulo the deprecated optional `view_tag`). The page then:

- `setKeys(loaded)`
- `setStep1Status("complete")`
- `setKeysDownloaded(true)` — the user already holds the file/vault, so the
  "You haven't downloaded your keys" warning on Continue is suppressed.
- toast: "Keys loaded"

The user lands on the unchanged "Keypair confirmed" view and proceeds via the
existing Continue button.

### 4. Implementation shape

- New component `LoadExistingKeysPanel` under
  `SPECTER-web/src/components/features/keys/`, structurally a trimmed sibling of
  `EnsExistingRecordPanel`: its own `pick-method | upload | vault` local state,
  with `onLoaded(keys: GenerateKeysResponse)` and `onBack()` callbacks. Reuses
  `listVaultEntries`, `getEntryUnlockMethod`, `VaultUnlockForm`.
- One new state field in `GenerateKeys`, e.g. `step1Mode: "generate" | "load"`,
  meaningful only while `step1Status === "idle"`. Reset to `"generate"` on back.
- Idle rendering: when `step1Mode === "generate"` show the current idle UI plus
  the new secondary action; when `"load"` render `LoadExistingKeysPanel`.
- No changes to Steps 2–4, the API layer, key types, or persistence.

## Out of scope (YAGNI)

- No key-format migration or versioning.
- No "verify loaded keys against the ENS record" here — that already lives in
  Step 2's keep-existing flow (`EnsExistingRecordPanel`).
- No new persistence; loading from file does not auto-save to the vault (the user
  can still use the existing "Save to this device" button on the confirmed view).

## Acceptance

- Step 1 idle shows "I already have keys" below Generate Keys.
- Selecting it offers Upload + (conditionally) Saved keys.
- A valid `specter-keys.json` upload or a successful vault unlock lands on the
  "Keypair confirmed" view with the loaded meta-address, and Continue proceeds to
  Step 2 without the download warning.
- An invalid/incomplete file shows an inline error and does not advance.
- "← Back to generate" returns to the unchanged idle Generate view.
- Steps 2–4 behave exactly as before.
