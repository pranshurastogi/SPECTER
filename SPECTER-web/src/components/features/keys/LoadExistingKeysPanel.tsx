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
import { looksLikeV1Keys, V1_KEYS_MESSAGE } from "@/lib/crypto/specter";
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

  // Reject protocol-v1 key material with a clear "regenerate + withdraw" message
  // instead of loading keys that can never find or spend v2 payments.
  const handleLoaded = (keys: GenerateKeysResponse): boolean => {
    if (looksLikeV1Keys(keys)) {
      setError(V1_KEYS_MESSAGE);
      return false;
    }
    onLoaded(keys);
    return true;
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      handleLoaded(parseKeyFile(text));
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
              onUnlock={(decrypted) => handleLoaded(toKeys(decrypted))}
              unlockLabel="Unlock & load"
              showEntryPicker={false}
            />
          )}
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
    </div>
  );
}
