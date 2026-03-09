import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  HardDrive,
  Lock,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listVaultEntries,
  unlockEntry,
  removeEntry,
  type VaultEntry,
  type DecryptedKeys,
} from "@/lib/keyVault";
import { toast } from "@/components/ui/sonner";

interface UnlockSavedKeysProps {
  onUnlock: (keys: DecryptedKeys) => void;
}

export function UnlockSavedKeys({ onUnlock }: UnlockSavedKeysProps) {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const refresh = useCallback(() => {
    const all = listVaultEntries();
    setEntries(all);
    if (all.length === 1) setSelectedId(all[0].id);
    return all;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (entries.length === 0) return null;

  const handleUnlock = async () => {
    if (!selectedId || !password) return;
    setUnlocking(true);
    setError(null);
    try {
      const keys = await unlockEntry(selectedId, password);
      toast.success("Keys unlocked");
      onUnlock(keys);
    } catch {
      setError("Wrong password or corrupted data");
    } finally {
      setUnlocking(false);
    }
  };

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
          <span className="text-sm font-medium text-foreground">
            Unlock saved keys
          </span>
          <span className="text-xs text-muted-foreground">
            ({entries.length} saved)
          </span>
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
              {/* Key selection */}
              {entries.length > 1 && (
                <div className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">
                    Choose a key set
                  </span>
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
                          onClick={() => {
                            setSelectedId(entry.id);
                            setError(null);
                            setPassword("");
                          }}
                        >
                          <p className="text-sm font-medium truncate">
                            {entry.label}
                          </p>
                          <p className="text-xs text-muted-foreground">
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

              {/* Single entry indicator */}
              {entries.length === 1 && selected && (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {selected.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Saved {new Date(selected.createdAt).toLocaleDateString()}
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

              {/* Password + unlock */}
              {selectedId && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder="Enter password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && password) handleUnlock();
                      }}
                      className="flex-1"
                      autoComplete="current-password"
                    />
                    <Button
                      variant="quantum"
                      size="default"
                      disabled={!password || unlocking}
                      onClick={handleUnlock}
                    >
                      {unlocking ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Lock className="h-4 w-4 mr-1.5" />
                          Unlock
                        </>
                      )}
                    </Button>
                  </div>
                  {error && (
                    <div className="flex items-center gap-1.5 text-xs text-destructive">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {error}
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
