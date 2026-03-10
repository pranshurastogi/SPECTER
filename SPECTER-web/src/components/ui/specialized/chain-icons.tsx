import { cn } from "@/lib/utils";

/** Ethereum logo (diamond) */
export function EthereumIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <path
        d="M11.944 17.97L4.58 13.62 11.943 24l7.37-10.38-7.372 4.35h.003zM12.056 0L4.69 12.223l7.365 4.354 7.365-4.35L12.056 0z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Sui logo (droplet) - official brand mark shape */
export function SuiIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <path
        d="M12 2C8.5 2 6 5.5 6 9c0 5 6 12 6 12s6-7 6-12c0-3.5-2.5-7-6-7z"
        fill="currentColor"
      />
    </svg>
  );
}
