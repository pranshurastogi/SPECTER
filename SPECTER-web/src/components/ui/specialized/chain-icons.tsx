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

/** Sui logo (droplet with inner stroke) */
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
      <path d="M12 2.2C8.8 2.2 6.2 5 6.2 8.7c0 5.2 5.8 12.9 5.8 12.9s5.8-7.7 5.8-12.9c0-3.7-2.6-6.5-5.8-6.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 6.1c-1.7 0-3 1.4-3 3.2 0 2.4 3 6.1 3 6.1s3-3.7 3-6.1c0-1.8-1.3-3.2-3-3.2Z" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

/** Arbitrum logo (hex shield with diagonal stripes) */
export function ArbitrumIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <path d="M12 1.9 4.8 6.1v11.8L12 22.1l7.2-4.2V6.1L12 1.9Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="m10.6 7.4-2.9 7h1.9l2.9-7h-1.9Zm3.1 1-2.8 6.7h1.9l2.8-6.7h-1.9Zm2.3 2.6-1.8 4.1h1.8l1.8-4.1H16Z" fill="currentColor" />
    </svg>
  );
}

/** Monad SVG logo (ring + stylized M) */
export function MonadIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" strokeWidth="1.8" opacity="0.55" />
      <path
        d="M7.2 15.8V8.2h2.1l2.7 3.8 2.7-3.8h2.1v7.6h-1.9v-4.9l-2.5 3.4h-.8l-2.5-3.4v4.9H7.2Z"
        fill="currentColor"
      />
    </svg>
  );
}
