import { DynamicContextProvider } from '@dynamic-labs/sdk-react-core';
import { EthereumWalletConnectors } from '@dynamic-labs/ethereum';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SuiWalletProvider } from './SuiWalletProvider';

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
