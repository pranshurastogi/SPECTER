/**
 * Key-free public RPC endpoints used as automatic fallbacks.
 *
 * Every client in this app layers these behind whatever primary the env vars
 * configure, so a provider outage degrades reads to "slower" instead of
 * "broken". That matters more than it sounds: a 401/429 from the primary used
 * to surface as an empty ENS record or a stealth address with no balance,
 * which reads to the user as "your money isn't there".
 *
 * Only endpoints verified to answer the calls this app actually makes belong
 * here — for mainnet that means `eth_call` against the ENS registry, not just
 * `eth_chainId`. Known-bad hosts are listed in {@link BROKEN_RPC_HOSTS} so a
 * stale env var can be ignored rather than silently breaking resolution.
 */

/** Hosts that answer `eth_chainId` but fail real ENS/eth_call traffic. */
export const BROKEN_RPC_HOSTS = [
  'cloudflare-eth.com', // "Internal error" on eth_call to the ENS registry
  'rpc.sepolia.org', // returns 404 HTML
  'rpc2.sepolia.org',
  'blastapi.io', // "Blast API is no longer available"
] as const;

/** True when a configured URL points at a host known to be unusable. */
export function isBrokenRpcUrl(url: string | undefined): boolean {
  if (!url) return true;
  return BROKEN_RPC_HOSTS.some((host) => url.includes(host));
}

/** Drops empty, duplicate, and known-broken URLs, preserving order. */
export function usableRpcUrls(...urls: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (!url || isBrokenRpcUrl(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export const ETH_MAINNET_FALLBACKS = [
  'https://ethereum.publicnode.com',
  'https://eth.drpc.org',
];

export const ETH_SEPOLIA_FALLBACKS = [
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://1rpc.io/sepolia',
];

export const ARB_SEPOLIA_FALLBACKS = [
  'https://sepolia-rollup.arbitrum.io/rpc',
  'https://arbitrum-sepolia-rpc.publicnode.com',
  'https://arbitrum-sepolia.drpc.org',
];

export const MONAD_TESTNET_FALLBACKS = [
  'https://testnet-rpc.monad.xyz',
  'https://rpc-testnet.monadinfra.com',
  'https://monad-testnet.drpc.org',
];
