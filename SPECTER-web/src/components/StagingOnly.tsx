import { isStagingDeployment } from "@/lib/appEnv";

type StagingOnlyProps = {
  children: React.ReactNode;
};

/** Renders `children` only when `VITE_APP_DEPLOYMENT=staging`. */
export function StagingOnly({ children }: StagingOnlyProps) {
  if (!isStagingDeployment()) return null;
  return <>{children}</>;
}
