import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  HardDrive,
  Loader2,
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
  removeEntry,
  clearVault,
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

type Step = "label" | "password" | "done";

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

  const refreshEntries = useCallback(() => {
    const entries = listVaultEntries();
    setExistingEntries(entries);
    return entries;
  }, []);

  const handleOpen = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        setStep("label");
        setLabel("");
        setPassword("");
        setConfirmPassword("");
        setSaving(false);
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

  const handleSave = async () => {
    if (!passwordValid || !passwordsMatch) return;
    setSaving(true);
    try {
      await saveToVault(keys, label || "My Keys", password);
      setStep("done");
      toast.success("Keys saved to this device");
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save keys");
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
            Encrypt your keys with a password and store them in this browser.
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {/* Existing keys warning */}
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
                    You can keep them alongside the new keys, or remove old ones first.
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
                      <p className="text-xs text-muted-foreground">
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

          {/* Step 1: Label */}
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
                <p className="text-xs text-muted-foreground">
                  Give your keys a name so you can identify them later.
                </p>
              </div>

              <Button
                variant="quantum"
                className="w-full"
                onClick={() => setStep("password")}
              >
                Set password
              </Button>
            </motion.div>
          )}

          {/* Step 2: Password */}
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
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                >
                  <PasswordConfirmInput
                    passwordToMatch={password}
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                  />
                </motion.div>
              )}

              <div className="flex gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-200">
                  If you forget this password, the only way to recover your keys
                  is from the <strong>downloaded JSON file</strong>. There is no
                  password reset.
                </p>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setPassword("");
                    setConfirmPassword("");
                    setStep("label");
                  }}
                >
                  Back
                </Button>
                <Button
                  variant="quantum"
                  className="flex-1"
                  disabled={!passwordValid || !passwordsMatch || saving}
                  onClick={handleSave}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Encrypt & save"
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {/* Step 3: Done */}
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
                <p className="text-sm font-medium text-foreground">
                  Keys saved securely
                </p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Your keys are encrypted and stored in this browser.
                  You can unlock them on the Scan page with your password.
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleOpen(false)}
              >
                Close
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
