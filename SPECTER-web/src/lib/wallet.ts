import { createConfig, http } from 'wagmi';
import { mainnet, sepolia } from 'wagmi/chains';
import { metaMask, walletConnect } from 'wagmi/connectors';

// WalletConnect requires a valid project ID from https://cloud.walletconnect.com
// When missing, we only enable MetaMask so the app still works (no 400 from pulse.walletconnect.org)
const projectId = import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID?.trim() || '';
const hasValidProjectId = projectId.length > 0 && projectId !== 'default-project-id';

const getOrigin = () => {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'https://specter.app';
};

const origin = getOrigin();

const connectors = [
  metaMask(),
  ...(hasValidProjectId
    ? [
        walletConnect({
          projectId,
          showQrModal: true,
          metadata: {
            name: 'SPECTER',
            description: 'Stealth Post-quantum ENS Cryptographic Transaction Engine for Routing - Private ENS payments using post-quantum cryptography',
            url: origin,
            icons: [`${origin}/favicon.ico`],
          },
        }),
      ]
    : []),
];

// Fallback to Cloudflare's public RPC if Alchemy env vars aren't set
// Cloudflare RPCs have CORS enabled for browser requests
const mainnetRpc = import.meta.env.VITE_ALCHEMY_RPC_MAINNET || 'https://cloudflare-eth.com';
const sepoliaRpc = import.meta.env.VITE_ALCHEMY_RPC_SEPOLIA || 'https://ethereum-sepolia-rpc.publicnode.com';

export const config = createConfig({
  chains: [mainnet, sepolia],
  connectors,
  transports: {
    [mainnet.id]: http(mainnetRpc),
    [sepolia.id]: http(sepoliaRpc),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
