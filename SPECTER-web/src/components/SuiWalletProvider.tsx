import { SuiClientProvider, WalletProvider } from '@mysten/dapp-kit';
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { useTestnet } from '@/lib/chainConfig';
import '@mysten/dapp-kit/dist/index.css';

const networks = {
  mainnet: { url: getJsonRpcFullnodeUrl('mainnet') },
  testnet: { url: getJsonRpcFullnodeUrl('testnet') },
};

const defaultNetwork = useTestnet ? 'testnet' : 'mainnet';

export function SuiWalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <SuiClientProvider networks={networks} defaultNetwork={defaultNetwork}>
      <WalletProvider autoConnect>
        {children}
      </WalletProvider>
    </SuiClientProvider>
  );
}
