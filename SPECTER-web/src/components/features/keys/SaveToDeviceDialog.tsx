import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Fingerprint,
  HardDrive,
  Loader2,
  Lock,
  Tag,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import { Label } from "@/components/ui/base/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/base/dialog";
import { PasswordConfirmInput } from "@/components/ui/specialized/password-confirm-input";
import {
  listVaultEntries,
  saveToVault,
  saveToVaultWithPasskey,
  removeEntry,
  clearVault,
  isPasskeyVaultSupported,
  PasskeyVaultError,
  getEntryUnlockMethod,
  type DecryptedKeys,
  type VaultEntry,
} from "@/lib/crypto/keyVault";
import { toast } from "@/components/ui/base/sonner";

interface SaveToDeviceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keys: DecryptedKeys;
  onSaved?: () => void;
}

type Step = "label" | "method" | "password" | "passkey" | "done";
type SaveMethod = "password" | "passkey";

const MIN_PASSWORD_LENGTH = 8;

export function SaveToDeviceDialog({
  open,
  onOpenChange,
  keys,
  onSaved,
}: SaveToDeviceDialogProps) {
  const [step, setStep] = useState<Step>("label");
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [existingEntries, setExistingEntries] = useState<VaultEntry[]>([]);
  const [showExistingWarning, setShowExistingWarning] = useState(false);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [saveMethod, setSaveMethod] = useState<SaveMethod | null>(null);

  const refreshEntries = useCallback(() => {
    const entries = listVaultEntries();
    setExistingEntries(entries);
    return entries;
  }, []);

  useEffect(() => {
    if (open) {
      void isPasskeyVaultSupported().then(setPasskeyAvailable);
    }
  }, [open]);

  const handleOpen = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        setStep("label");
        setLabel("");
        setPassword("");
        setConfirmPassword("");
        setSaving(false);
        setSaveMethod(null);
        const entries = refreshEntries();
        setShowExistingWarning(entries.length > 0);
      }
      onOpenChange(isOpen);
    },
    [onOpenChange, refreshEntries],
  );

  const handleRemoveEntry = (id: string) => {
    removeEntry(id);
    const updated = refreshEntries();
    if (updated.length === 0) setShowExistingWarning(false);
  };

  const handleClearAll = () => {
    clearVault();
    setExistingEntries([]);
    setShowExistingWarning(false);
  };

  const passwordValid = password.length >= MIN_PASSWORD_LENGTH;
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;

  const handleSavePassword = async () => {
    if (!passwordValid || !passwordsMatch) return;
    setSaving(true);
    try {
      await saveToVault(keys, label || "My Keys", password);
      setSaveMethod("password");
      setStep("done");
      toast.success("Keys saved to this device");
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save keys");
    } finally {
      setSaving(false);
    }
  };

  const handleSavePasskey = async () => {
    setSaving(true);
    try {
      await saveToVaultWithPasskey(keys, label || "My Keys");
      setSaveMethod("passkey");
      setStep("done");
      toast.success("Keys saved with passkey");
      onSaved?.();
    } catch (err) {
      const message =
        err instanceof PasskeyVaultError
          ? err.userMessage
          : err instanceof Error
            ? err.message
            : "Failed to save with passkey";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-primary" />
            Save to this device
          </DialogTitle>
          <DialogDescription>
            Encrypt your keys and store them in this browser. Choose a password or passkey to unlock later.
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {showExistingWarning && step === "label" && (
            <motion.div
              key="existing"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-3"
            >
              <div className="flex gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-amber-200">
                    You already have {existingEntries.length} saved key
                    {existingEntries.length > 1 ? "s" : ""}
                  </p>
                  <p className="text-muted-foreground text-xs mt-1">
                    New keys can be saved alongside existing entries.
                  </p>
                </div>
              </div>

              <div className="space-y-2 max-h-40 overflow-y-auto">
                {existingEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-muted/40 border border-border"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{entry.label}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        {getEntryUnlockMethod(entry) === "passkey" ? (
                          <Fingerprint className="h-3 w-3" />
                        ) : (
                          <Lock className="h-3 w-3" />
                        )}
                        {getEntryUnlockMethod(entry) === "passkey" ? "Passkey" : "Password"}
                        {" · "}
                        {new Date(entry.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => handleRemoveEntry(entry.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>

              {existingEntries.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={handleClearAll}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Clear all saved keys
                </Button>
              )}
            </motion.div>
          )}

          {step === "label" && (
            <motion.div
              key="label"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="space-y-4 pt-2"
            >
              <div className="space-y-2">
                <Label htmlFor="key-label" className="flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5" />
                  Label (optional)
                </Label>
                <Input
                  id="key-label"
                  placeholder='e.g. "Main wallet" or "Trading keys"'
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={48}
                />
              </div>

              <Button variant="quantum" className="w-full" onClick={() => setStep("method")}>
                Choose how to protect keys
              </Button>
            </motion.div>
          )}

          {step === "method" && (
            <motion.div
              key="method"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="space-y-3 pt-2"
            >
              <p className="text-xs text-muted-foreground">
                Both options encrypt keys locally. Passkeys use your device biometrics; passwords work everywhere.
              </p>

              <button
                type="button"
                onClick={() => setStep("password")}
                className="flex items-center gap-3 w-full p-3 rounded-lg border border-border bg-card hover:bg-muted/40 hover:border-primary/30 transition-colors text-left"
              >
                <Lock className="h-5 w-5 text-primary shrink-0" />
                <div>
                  <p className="text-sm font-medium">Password</p>
                  <p className="text-xs text-muted-foreground">
                    Encrypt with a memorable password (min. {MIN_PASSWORD_LENGTH} characters)
                  </p>
                </div>
              </button>

              <button
                type="button"
                disabled={!passkeyAvailable}
                onClick={() => setStep("passkey")}
                className="flex items-center gap-3 w-full p-3 rounded-lg border border-border bg-card hover:bg-muted/40 hover:border-primary/30 transition-colors text-left disabled:opacity-50 disabled:pointer-events-none"
              >
                <Fingerprint className="h-5 w-5 text-primary shrink-0" />
                <div>
                  <p className="text-sm font-medium">Passkey</p>
                  <p className="text-xs text-muted-foreground">
                    {passkeyAvailable
                      ? "Touch ID, Face ID, or Windows Hello — phishing-resistant unlock"
                      : "Not available in this browser or context (requires HTTPS)"}
                  </p>
                </div>
              </button>

              <div className="flex gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-200">
                  Always keep your <strong>specter-keys.json</strong> backup. Passkeys are tied to this device/browser; passwords can be forgotten.
                </p>
              </div>

              <Button variant="outline" className="w-full" onClick={() => setStep("label")}>
                Back
              </Button>
            </motion.div>
          )}

          {step === "password" && (
            <motion.div
              key="password"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="space-y-4 pt-2"
            >
              <div className="space-y-2">
                <Label htmlFor="vault-password">Encryption password</Label>
                <Input
                  id="vault-password"
                  type="password"
                  placeholder="Min. 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
                {password.length > 0 && !passwordValid && (
                  <p className="text-xs text-destructive">
                    At least {MIN_PASSWORD_LENGTH} characters required
                  </p>
                )}
              </div>

              {passwordValid && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
                  <PasswordConfirmInput
                    passwordToMatch={password}
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                  />
                </motion.div>
              )}

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setPassword("");
                    setConfirmPassword("");
                    setStep("method");
                  }}
                >
                  Back
                </Button>
                <Button
                  variant="quantum"
                  className="flex-1"
                  disabled={!passwordValid || !passwordsMatch || saving}
                  onClick={handleSavePassword}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Encrypt & save"}
                </Button>
              </div>
            </motion.div>
          )}

          {step === "passkey" && (
            <motion.div
              key="passkey"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="space-y-4 pt-2"
            >
              <div className="p-3 rounded-lg bg-muted/40 border border-border space-y-2">
                <p className="text-sm text-foreground">
                  You will be prompted to create a passkey for <strong>{label || "My Keys"}</strong>.
                </p>
                <p className="text-xs text-muted-foreground">
                  SPECTER never uploads your private keys. The passkey only derives an encryption key via a secure PRF — your stealth keys stay encrypted in this browser.
                </p>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setStep("method")} disabled={saving}>
                  Back
                </Button>
                <Button
                  variant="quantum"
                  className="flex-1"
                  disabled={saving}
                  onClick={handleSavePasskey}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Fingerprint className="h-4 w-4 mr-1.5" />
                      Create passkey
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {step === "done" && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-4 pt-2"
            >
              <div className="flex flex-col items-center text-center py-4">
                <div className="w-12 h-12 rounded-full bg-success/10 border border-success/20 flex items-center justify-center mb-3">
                  <CheckCircle2 className="h-6 w-6 text-success" />
                </div>
                <p className="text-sm font-medium text-foreground">Keys saved securely</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  {saveMethod === "passkey"
                    ? "Unlock with your passkey on the Scan page or when verifying keys."
                    : "Unlock with your password on the Scan page or when verifying keys."}
                </p>
              </div>
              <Button variant="outline" className="w-full" onClick={() => handleOpen(false)}>
                Close
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
