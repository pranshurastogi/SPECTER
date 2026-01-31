import { createConfig, http } from 'wagmi';
import { mainnet, sepolia } from 'wagmi/chains';
import { metaMask, walletConnect } from 'wagmi/connectors';

// Get project ID from environment or use a default
const projectId = import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID || 'default-project-id';

// Get the origin URL for metadata
const getOrigin = () => {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'https://specter.app';
};

const origin = getOrigin();

export const config = createConfig({
  chains: [mainnet, sepolia],
  connectors: [
    metaMask(),
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
  ],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
