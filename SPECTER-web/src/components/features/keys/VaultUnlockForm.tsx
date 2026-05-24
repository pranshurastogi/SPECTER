import { useState, useCallback } from "react";
import { AlertTriangle, Fingerprint, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import {
  unlockVaultEntry,
  getEntryUnlockMethod,
  isPasskeyVaultEntry,
  formatVaultUnlockError,
  VaultError,
  type VaultEntry,
  type DecryptedKeys,
} from "@/lib/crypto/keyVault";

export interface VaultUnlockFormProps {
  entries: VaultEntry[];
  selectedId: string | null;
  onSelectId: (id: string) => void;
  onUnlock: (keys: DecryptedKeys) => void | Promise<void>;
  /** Primary action label (default: Unlock). */
  unlockLabel?: string;
  /** Compact styling for Scan page dark panel. */
  variant?: "default" | "scan";
  /** Hide entry picker when only one entry (still shows passkey/password UI). */
  showEntryPicker?: boolean;
  className?: string;
}

export function VaultUnlockForm({
  entries,
  selectedId,
  onSelectId,
  onUnlock,
  unlockLabel = "Unlock",
  variant = "default",
  showEntryPicker = true,
  className = "",
}: VaultUnlockFormProps) {
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = entries.find((e) => e.id === selectedId);
  const isPasskey = selected ? isPasskeyVaultEntry(selected) : false;

  const resetError = useCallback(() => setError(null), []);

  const handleUnlock = async () => {
    if (!selectedId) return;
    if (!isPasskey && !password) return;

    setUnlocking(true);
    setError(null);
    try {
      const keys = await unlockVaultEntry(
        selectedId,
        isPasskey ? undefined : password,
      );
      setPassword("");
      await onUnlock(keys);
    } catch (err) {
      if (err instanceof VaultError && err.code === "PASSWORD_REQUIRED") {
        setError("Enter your vault password.");
      } else {
        setError(formatVaultUnlockError(err));
      }
    } finally {
      setUnlocking(false);
    }
  };

  if (!selectedId || !selected) return null;

  const isScan = variant === "scan";

  return (
    <div className={`space-y-2 ${className}`}>
      {showEntryPicker && entries.length > 1 && (
        <div className={isScan ? "flex flex-wrap gap-1.5" : "space-y-1.5 max-h-32 overflow-y-auto"}>
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                onSelectId(entry.id);
                setPassword("");
                resetError();
              }}
              className={
                isScan
                  ? `px-2.5 py-1 rounded-md text-xs font-medium font-display transition-colors border ${
                      selectedId === entry.id
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-white/10 bg-white/5 text-white/50 hover:bg-white/10"
                    }`
                  : `flex items-center justify-between gap-2 w-full p-2 rounded-md border text-left transition-colors ${
                      selectedId === entry.id
                        ? "border-primary bg-primary/10"
                        : "border-border bg-muted/30 hover:bg-muted/50"
                    }`
              }
            >
              <span className={isScan ? undefined : "text-sm font-medium truncate"}>
                {entry.label}
              </span>
              {!isScan && (
                <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1.5">
                  {getEntryUnlockMethod(entry) === "passkey" ? (
                    <Fingerprint className="h-3 w-3" />
                  ) : (
                    <Lock className="h-3 w-3" />
                  )}
                  {new Date(entry.createdAt).toLocaleDateString()}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {entries.length === 1 && !isScan && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          {isPasskey ? (
            <Fingerprint className="h-3 w-3" />
          ) : (
            <Lock className="h-3 w-3" />
          )}
          {selected.label}
          {" · "}
          {getEntryUnlockMethod(selected) === "passkey" ? "Passkey" : "Password"}
          {" · "}
          {new Date(selected.createdAt).toLocaleDateString()}
        </p>
      )}

      {isPasskey ? (
        <div className="space-y-2">
          <p className={isScan ? "text-xs text-white/40 font-display" : "text-xs text-muted-foreground"}>
            Use your device passkey (Touch ID, Face ID, Windows Hello, etc.) to decrypt this vault.
          </p>
          <Button
            variant="quantum"
            size="default"
            className="w-full shrink-0"
            disabled={unlocking}
            onClick={handleUnlock}
          >
            {unlocking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Fingerprint className="h-4 w-4 mr-1.5" />
                {unlockLabel.includes("passkey") ? unlockLabel : `${unlockLabel} with passkey`}
              </>
            )}
          </Button>
        </div>
      ) : (
        <div className={isScan ? "flex gap-2" : "flex gap-2"}>
          {isScan ? (
            <input
              type="password"
              placeholder="Enter vault password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                resetError();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && password && !unlocking) handleUnlock();
              }}
              className="flex-1 h-10 px-3 rounded-lg bg-white/[0.04] border border-white/10 text-sm text-white/80 placeholder:text-white/25 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-colors font-display"
              autoComplete="current-password"
              disabled={unlocking}
            />
          ) : (
            <Input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                resetError();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && password) handleUnlock();
              }}
              className="flex-1"
              autoComplete="current-password"
              disabled={unlocking}
            />
          )}
          <Button
            variant="quantum"
            size="default"
            disabled={!password || unlocking}
            onClick={handleUnlock}
            className="shrink-0"
          >
            {unlocking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Lock className="h-4 w-4 mr-1.5" />
                {unlockLabel}
              </>
            )}
          </Button>
        </div>
      )}

      {error && (
        <div
          className={`flex items-center gap-1.5 text-xs text-destructive ${
            isScan ? "" : ""
          }`}
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}
