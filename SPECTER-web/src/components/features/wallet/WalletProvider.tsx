import { DynamicContextProvider } from '@dynamic-labs/sdk-react-core';
import { EthereumWalletConnectors } from '@dynamic-labs/ethereum';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SuiWalletProvider } from './SuiWalletProvider';
import { chain } from '@/lib/blockchain/chainConfig';
import {
  mainnet,
  sepolia,
  base,
  baseSepolia,
  polygon,
  polygonAmoy,
  bsc,
  linea,
} from 'viem/chains';

const queryClient = new QueryClient();

/**
 * Build EVM network config for Dynamic Labs
 * Includes all Yellow Network supported chains for both sandbox and production
 */
const buildEvmNetworks = () => {
  const networks = [];

  // Primary SPECTER chain (for core app functions like ENS, stealth addresses)
  networks.push({
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
  });

  // Yellow Network Sandbox chains (testnets)
  // Sepolia (if not already the primary chain)
  if (chain.id !== sepolia.id) {
    networks.push({
      blockExplorerUrls: [sepolia.blockExplorers.default.url],
      chainId: sepolia.id,
      chainName: sepolia.name,
      iconUrls: ['https://app.dynamic.xyz/assets/networks/eth.svg'],
      name: sepolia.name,
      nativeCurrency: sepolia.nativeCurrency,
      networkId: sepolia.id,
      rpcUrls: [
        import.meta.env.VITE_YELLOW_SANDBOX_RPC_SEPOLIA ||
          'https://ethereum-sepolia-rpc.publicnode.com',
      ],
      vanityName: 'Sepolia Testnet',
    });
  }

  // Base Sepolia
  networks.push({
    blockExplorerUrls: [baseSepolia.blockExplorers.default.url],
    chainId: baseSepolia.id,
    chainName: baseSepolia.name,
    iconUrls: ['https://app.dynamic.xyz/assets/networks/base.svg'],
    name: baseSepolia.name,
    nativeCurrency: baseSepolia.nativeCurrency,
    networkId: baseSepolia.id,
    rpcUrls: [
      import.meta.env.VITE_YELLOW_SANDBOX_RPC_BASE ||
        'https://sepolia.base.org',
    ],
    vanityName: 'Base Sepolia',
  });

  // Polygon Amoy
  networks.push({
    blockExplorerUrls: [polygonAmoy.blockExplorers.default.url],
    chainId: polygonAmoy.id,
    chainName: polygonAmoy.name,
    iconUrls: ['https://app.dynamic.xyz/assets/networks/polygon.svg'],
    name: polygonAmoy.name,
    nativeCurrency: polygonAmoy.nativeCurrency,
    networkId: polygonAmoy.id,
    rpcUrls: [
      import.meta.env.VITE_YELLOW_SANDBOX_RPC_POLYGON ||
        'https://rpc-amoy.polygon.technology',
    ],
    vanityName: 'Polygon Amoy',
  });

  // Yellow Network Production chains (mainnets)
  // Ethereum Mainnet (if not already the primary chain)
  if (chain.id !== mainnet.id) {
    networks.push({
      blockExplorerUrls: [mainnet.blockExplorers.default.url],
      chainId: mainnet.id,
      chainName: mainnet.name,
      iconUrls: ['https://app.dynamic.xyz/assets/networks/eth.svg'],
      name: mainnet.name,
      nativeCurrency: mainnet.nativeCurrency,
      networkId: mainnet.id,
      rpcUrls: [
        import.meta.env.VITE_YELLOW_MAINNET_RPC_ETH ||
          'https://cloudflare-eth.com',
      ],
      vanityName: 'Ethereum',
    });
  }

  // Base Mainnet
  networks.push({
    blockExplorerUrls: [base.blockExplorers.default.url],
    chainId: base.id,
    chainName: base.name,
    iconUrls: ['https://app.dynamic.xyz/assets/networks/base.svg'],
    name: base.name,
    nativeCurrency: base.nativeCurrency,
    networkId: base.id,
    rpcUrls: [
      import.meta.env.VITE_YELLOW_MAINNET_RPC_BASE ||
        'https://mainnet.base.org',
    ],
    vanityName: 'Base',
  });

  // Polygon Mainnet
  networks.push({
    blockExplorerUrls: [polygon.blockExplorers.default.url],
    chainId: polygon.id,
    chainName: polygon.name,
    iconUrls: ['https://app.dynamic.xyz/assets/networks/polygon.svg'],
    name: polygon.name,
    nativeCurrency: polygon.nativeCurrency,
    networkId: polygon.id,
    rpcUrls: [
      import.meta.env.VITE_YELLOW_MAINNET_RPC_POLYGON ||
        'https://polygon-rpc.com',
    ],
    vanityName: 'Polygon',
  });

  // BNB Smart Chain
  networks.push({
    blockExplorerUrls: [bsc.blockExplorers.default.url],
    chainId: bsc.id,
    chainName: bsc.name,
    iconUrls: ['https://app.dynamic.xyz/assets/networks/bnb.svg'],
    name: bsc.name,
    nativeCurrency: bsc.nativeCurrency,
    networkId: bsc.id,
    rpcUrls: [
      import.meta.env.VITE_YELLOW_MAINNET_RPC_BSC ||
        'https://bsc-dataseed.binance.org',
    ],
    vanityName: 'BNB Smart Chain',
  });

  // Linea
  networks.push({
    blockExplorerUrls: [linea.blockExplorers.default.url],
    chainId: linea.id,
    chainName: linea.name,
    iconUrls: ['https://app.dynamic.xyz/assets/networks/linea.svg'],
    name: linea.name,
    nativeCurrency: linea.nativeCurrency,
    networkId: linea.id,
    rpcUrls: [
      import.meta.env.VITE_YELLOW_MAINNET_RPC_LINEA ||
        'https://rpc.linea.build',
    ],
    vanityName: 'Linea',
  });

  // World Chain (custom - not in viem/chains)
  networks.push({
    blockExplorerUrls: ['https://worldchain-mainnet.explorer.alchemy.com'],
    chainId: 480,
    chainName: 'World Chain',
    iconUrls: ['https://app.dynamic.xyz/assets/networks/worldchain.svg'],
    name: 'World Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    networkId: 480,
    rpcUrls: ['https://worldchain-mainnet.g.alchemy.com/public'],
    vanityName: 'World Chain',
  });

  // XRPL EVM Sidechain (custom)
  networks.push({
    blockExplorerUrls: ['https://explorer.xrplevm.org'],
    chainId: 1440000,
    chainName: 'XRPL EVM Sidechain',
    iconUrls: ['https://app.dynamic.xyz/assets/networks/xrp.svg'],
    name: 'XRPL EVM',
    nativeCurrency: { name: 'XRP', symbol: 'XRP', decimals: 18 },
    networkId: 1440000,
    rpcUrls: ['https://rpc-evm-sidechain.xrpl.org'],
    vanityName: 'XRPL EVM',
  });

  return networks;
};

export function WalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <DynamicContextProvider
      settings={{
        environmentId:
          import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID ||
          'YOUR_DYNAMIC_ENVIRONMENT_ID',
        walletConnectors: [EthereumWalletConnectors],
        appName: 'SPECTER',
        evmNetworks: buildEvmNetworks(),
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
