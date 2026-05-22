/**
 * Deployment tier for the static frontend (Vite `import.meta.env`).
 * Set `VITE_APP_DEPLOYMENT=staging` only on staging; use `main` (or omit) for production.
 */
export type AppDeployment = "staging" | "main";

export function normalizeAppDeployment(raw: string | undefined): AppDeployment {
  const v = raw?.trim().toLowerCase();
  return v === "staging" ? "staging" : "main";
}

export function getAppDeployment(): AppDeployment {
  return normalizeAppDeployment(import.meta.env.VITE_APP_DEPLOYMENT);
}

export function isStagingDeployment(): boolean {
  return getAppDeployment() === "staging";
}
