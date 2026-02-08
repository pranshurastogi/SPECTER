import { DynamicContextProvider } from '@dynamic-labs/sdk-react-core';
import { EthereumWalletConnectors } from '@dynamic-labs/ethereum';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SuiWalletProvider } from './SuiWalletProvider';
import { chain } from '@/lib/chainConfig';

const queryClient = new QueryClient();

export function WalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <DynamicContextProvider
      settings={{
        environmentId:
          import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID ||
          'YOUR_DYNAMIC_ENVIRONMENT_ID',
        walletConnectors: [EthereumWalletConnectors],
        appName: 'SPECTER',
        evmNetworks: [
          {
            blockExplorerUrls: [chain.blockExplorers.default.url],
            chainId: chain.id,
            chainName: chain.name,
            iconUrls: ['https://app.dynamic.xyz/assets/networks/eth.svg'],
            name: chain.name,
            nativeCurrency: chain.nativeCurrency,
            networkId: chain.id,
            rpcUrls: [
              import.meta.env.VITE_ETH_RPC_URL ||
                (chain.id === 1
                  ? 'https://cloudflare-eth.com'
                  : 'https://ethereum-sepolia-rpc.publicnode.com'),
            ],
            vanityName: chain.name,
          },
        ],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <SuiWalletProvider>
          {children}
        </SuiWalletProvider>
      </QueryClientProvider>
    </DynamicContextProvider>
  );
}
