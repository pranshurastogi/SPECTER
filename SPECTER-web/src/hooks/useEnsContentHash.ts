/**
 * Hook to fetch ENS content hash (IPFS CID) from the resolver's contenthash().
 * Content hash is NOT a text record - it comes from the resolver contract (EIP-1577).
 *
 * @see https://docs.ens.domains/dweb/intro
 * @see https://eips.ethereum.org/EIPS/eip-1577
 */

import { useQuery } from '@tanstack/react-query';
import { getIpfsContentHash } from '@/lib/ensResolver';

export interface UseEnsContentHashOptions {
    enabled?: boolean;
    chainId?: number;
}

export function useEnsContentHash(
    name: string | null | undefined,
    options: UseEnsContentHashOptions = {}
): {
    ipfsHash: string | null;
    ipfsUrl: string | null;
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
    refetch: () => void;
} {
    const { enabled = true, chainId: chainIdOverride } = options;
    // ENS lives on mainnet; default to chain 1
    const effectiveChainId = chainIdOverride ?? 1;

    const {
        data: ipfsHash,
        isLoading,
        isError,
        error,
        refetch,
    } = useQuery({
        queryKey: ['ens-content-hash', name ?? '', effectiveChainId],
        queryFn: () => getIpfsContentHash(name!, effectiveChainId),
        enabled: enabled && !!name && name.trim().length > 0,
        staleTime: 2 * 60 * 1000,
        gcTime: 5 * 60 * 1000,
    });

    const gateway = import.meta.env.VITE_IPFS_GATEWAY || 'https://ipfs.io';
    const ipfsUrl =
        ipfsHash != null && ipfsHash.length > 0
            ? `${gateway.replace(/\/$/, '')}/ipfs/${ipfsHash.replace(/^ipfs:\/\//, '').replace(/^\/ipfs\//, '')}`
            : null;

    return {
        ipfsHash: ipfsHash ?? null,
        ipfsUrl,
        isLoading,
        isError,
        error: error as Error | null,
        refetch,
    };
}
