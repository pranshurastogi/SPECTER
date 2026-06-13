import { cn } from "@/lib/utils";
import {
  NetworkEthereum,
  NetworkArbitrumOne,
  NetworkSui,
  NetworkMonad,
} from "@web3icons/react";

export function EthereumIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return <NetworkEthereum width={size} height={size} className={cn("shrink-0", className)} aria-hidden />;
}

export function ArbitrumIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return <NetworkArbitrumOne width={size} height={size} className={cn("shrink-0", className)} aria-hidden />;
}

export function SuiIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return <NetworkSui width={size} height={size} className={cn("shrink-0", className)} aria-hidden />;
}

export function MonadIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return <NetworkMonad width={size} height={size} className={cn("shrink-0", className)} aria-hidden />;
}
