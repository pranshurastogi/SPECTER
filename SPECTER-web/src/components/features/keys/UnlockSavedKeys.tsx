import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  HardDrive,
  ChevronDown,
  ChevronUp,
  Trash2,
  Fingerprint,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/base/button";
import {
  listVaultEntries,
  removeEntry,
  getEntryUnlockMethod,
  type VaultEntry,
  type DecryptedKeys,
} from "@/lib/crypto/keyVault";
import { VaultUnlockForm } from "@/components/features/keys/VaultUnlockForm";
import { toast } from "@/components/ui/base/sonner";

interface UnlockSavedKeysProps {
  onUnlock: (keys: DecryptedKeys) => void;
}

export function UnlockSavedKeys({ onUnlock }: UnlockSavedKeysProps) {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const refresh = useCallback(() => {
    const all = listVaultEntries();
    setEntries(all);
    if (all.length === 1) setSelectedId(all[0]!.id);
    else if (selectedId && !all.some((e) => e.id === selectedId)) {
      setSelectedId(all[0]?.id ?? null);
    }
    return all;
  }, [selectedId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (entries.length === 0) return null;

  const handleRemove = (id: string) => {
    removeEntry(id);
    const updated = refresh();
    if (selectedId === id) setSelectedId(updated[0]?.id ?? null);
    toast.info("Removed saved keys");
  };

  const selected = entries.find((e) => e.id === selectedId);

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 p-3 text-left hover:bg-primary/10 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">Unlock saved keys</span>
          <span className="text-xs text-muted-foreground">({entries.length} saved)</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3">
              {entries.length > 1 && (
                <div className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">Choose a key set</span>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {entries.map((entry) => (
                      <div
                        key={entry.id}
                        className={`flex items-center justify-between gap-2 p-2 rounded-md border cursor-pointer transition-colors ${
                          selectedId === entry.id
                            ? "border-primary bg-primary/10"
                            : "border-border bg-muted/30 hover:bg-muted/50"
                        }`}
                      >
                        <button
                          type="button"
                          className="flex-1 text-left min-w-0"
                          onClick={() => setSelectedId(entry.id)}
                        >
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
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0 h-7 w-7 p-0 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemove(entry.id);
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {entries.length === 1 && selected && (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{selected.label}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      {getEntryUnlockMethod(selected) === "passkey" ? (
                        <Fingerprint className="h-3 w-3" />
                      ) : (
                        <Lock className="h-3 w-3" />
                      )}
                      {getEntryUnlockMethod(selected) === "passkey" ? "Passkey" : "Password"}
                      {" · "}
                      {new Date(selected.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleRemove(selected.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}

              {selectedId && (
                <VaultUnlockForm
                  entries={entries}
                  selectedId={selectedId}
                  onSelectId={setSelectedId}
                  onUnlock={(keys) => {
                    toast.success("Keys unlocked");
                    onUnlock(keys);
                  }}
                  showEntryPicker={false}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
