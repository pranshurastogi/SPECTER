import { useState, useEffect } from "react";
import { api } from "@/lib/api";

export function useApiHealth(refreshIntervalMs = 30_000) {
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        await api.health();
        if (!cancelled) setOk(true);
      } catch {
        if (!cancelled) setOk(false);
      }
    };

    check();
    const id = setInterval(check, refreshIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refreshIntervalMs]);

  return { ok, loading: ok === null };
}
