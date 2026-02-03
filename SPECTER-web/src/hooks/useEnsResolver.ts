/**
 * React Hook for ENS Resolution
 * 
 * Provides stateful ENS resolution with loading states, error handling,
 * and automatic caching using React Query.
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useChainId } from 'wagmi';
import type { Address } from 'viem';
import {
    resolveEns,
    validateEnsName,
    EnsResolverError,
    type EnsResolutionResult,
    EnsErrorCode,
} from '@/lib/ensResolver';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UseEnsResolverOptions {
    /** Enable automatic resolution on mount/name change */
    enabled?: boolean;
    /** Debounce delay in ms for auto-resolution */
    debounceMs?: number;
    /** Cache time in ms (default: 5 minutes) */
    cacheTime?: number;
    /** Stale time in ms (default: 2 minutes) */
    staleTime?: number;
    /** Chain ID override (uses wallet chain by default) */
    chainId?: number;
    /** Callback on successful resolution */
    onSuccess?: (result: EnsResolutionResult) => void;
    /** Callback on error */
    onError?: (error: EnsResolverError) => void;
}

export interface UseEnsResolverReturn {
    /** Resolved Ethereum address */
    address: Address | null;
    /** Normalized ENS name */
    name: string | null;
    /** ENS avatar URL */
    avatar: string | null;
    /** Raw content hash */
    contentHash: string | null;
    /** Extracted IPFS hash */
    ipfsHash: string | null;
    /** Full IPFS gateway URL */
    ipfsUrl: string | null;
    /** Loading state */
    isLoading: boolean;
    /** Error state */
    isError: boolean;
    /** Error object */
    error: EnsResolverError | null;
    /** Success state */
    isSuccess: boolean;
    /** Manually trigger resolution */
    resolve: (ensName: string) => Promise<void>;
    /** Reset all state */
    reset: () => void;
    /** Refetch current ENS name */
    refetch: () => Promise<void>;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Hook for resolving ENS names with state management.
 * 
 * @example
 * ```tsx
 * const { address, ipfsUrl, isLoading, error, resolve } = useEnsResolver();
 * 
 * const handleResolve = async () => {
 *   await resolve('vitalik.eth');
 * };
 * ```
 */
export function useEnsResolver(
    initialName?: string,
    options: UseEnsResolverOptions = {}
): UseEnsResolverReturn {
    const {
        enabled = false,
        debounceMs = 500,
        cacheTime = 5 * 60 * 1000, // 5 minutes
        staleTime = 2 * 60 * 1000, // 2 minutes
        chainId: chainIdOverride,
        onSuccess,
        onError,
    } = options;

    const walletChainId = useChainId();
    const queryClient = useQueryClient();
    const [ensName, setEnsName] = useState<string | null>(initialName || null);
    const [debouncedName, setDebouncedName] = useState<string | null>(initialName || null);

    // Debounce ENS name input
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedName(ensName);
        }, debounceMs);

        return () => clearTimeout(timer);
    }, [ensName, debounceMs]);

    // Determine which chain ID to use
    const effectiveChainId = chainIdOverride || walletChainId;

    // Query key for caching
    const queryKey = ['ens-resolution', debouncedName, effectiveChainId];

    // React Query for ENS resolution
    const {
        data,
        error: queryError,
        isLoading,
        isError,
        isSuccess,
        refetch: queryRefetch,
    } = useQuery<EnsResolutionResult, EnsResolverError>({
        queryKey,
        queryFn: async () => {
            if (!debouncedName) {
                throw new EnsResolverError(
                    'No ENS name provided',
                    EnsErrorCode.INVALID_NAME
                );
            }

            try {
                validateEnsName(debouncedName);
                const result = await resolveEns(debouncedName, effectiveChainId);

                if (onSuccess) {
                    onSuccess(result);
                }

                return result;
            } catch (error) {
                const ensError = error instanceof EnsResolverError
                    ? error
                    : new EnsResolverError(
                        error instanceof Error ? error.message : 'Unknown error during ENS resolution',
                        EnsErrorCode.UNKNOWN,
                        error
                    );

                if (onError) {
                    onError(ensError);
                }

                throw ensError;
            }
        },
        enabled: enabled && !!debouncedName,
        gcTime: cacheTime,
        staleTime,
        retry: (failureCount, error) => {
            // Don't retry on validation errors or name not found
            if (
                error instanceof EnsResolverError &&
                (error.code === EnsErrorCode.INVALID_NAME ||
                    error.code === EnsErrorCode.NAME_NOT_FOUND)
            ) {
                return false;
            }
            // Retry network errors up to 2 times
            return failureCount < 2;
        },
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
    });

    // Manual resolve function
    const resolve = useCallback(
        async (name: string) => {
            setEnsName(name);
            // Immediately set debounced name for manual resolution (skip debounce)
            setDebouncedName(name);

            // Invalidate and refetch
            await queryClient.invalidateQueries({ queryKey: ['ens-resolution', name, effectiveChainId] });
        },
        [effectiveChainId, queryClient]
    );

    // Reset function
    const reset = useCallback(() => {
        setEnsName(null);
        setDebouncedName(null);
        queryClient.removeQueries({ queryKey });
    }, [queryClient, queryKey]);

    // Refetch function
    const refetch = useCallback(async () => {
        if (debouncedName) {
            await queryRefetch();
        }
    }, [debouncedName, queryRefetch]);

    // Extract fields from result
    const address = data?.address || null;
    const name = data?.name || null;
    const avatar = data?.avatar || null;
    const contentHash = data?.contentHash || null;
    const ipfsHash = data?.ipfsHash || null;
    const ipfsUrl = data?.ipfsUrl || null;
    const error = (queryError as EnsResolverError) || null;

    return {
        address,
        name,
        avatar,
        contentHash,
        ipfsHash,
        ipfsUrl,
        isLoading,
        isError,
        error,
        isSuccess,
        resolve,
        reset,
        refetch,
    };
}

// ─── Simple Hook Variant ────────────────────────────────────────────────────

/**
 * Simplified hook that just resolves ENS to address.
 * Useful when you don't need IPFS or avatar data.
 */
export function useEnsAddress(
    ensName?: string,
    options: Omit<UseEnsResolverOptions, 'enabled'> = {}
): {
    address: Address | null;
    isLoading: boolean;
    error: EnsResolverError | null;
} {
    const { address, isLoading, error } = useEnsResolver(ensName, {
        ...options,
        enabled: !!ensName,
    });

    return { address, isLoading, error };
}

/**
 * Hook specifically for getting IPFS content from ENS.
 */
export function useEnsIpfs(
    ensName?: string,
    options: Omit<UseEnsResolverOptions, 'enabled'> = {}
): {
    ipfsHash: string | null;
    ipfsUrl: string | null;
    isLoading: boolean;
    error: EnsResolverError | null;
} {
    const { ipfsHash, ipfsUrl, isLoading, error } = useEnsResolver(ensName, {
        ...options,
        enabled: !!ensName,
    });

    return { ipfsHash, ipfsUrl, isLoading, error };
}
