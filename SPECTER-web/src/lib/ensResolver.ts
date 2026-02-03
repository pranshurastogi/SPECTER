/**
 * ENS Resolver Utility Library
 * 
 * Provides comprehensive ENS name resolution with IPFS content retrieval.
 * Uses viem for direct blockchain queries with proper error handling.
 */

import { createPublicClient, http, type PublicClient, type Address } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { normalize } from 'viem/ens';

// ─── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_IPFS_GATEWAY = import.meta.env.VITE_IPFS_GATEWAY || 'https://ipfs.io';
const DEFAULT_TIMEOUT_MS = parseInt(import.meta.env.VITE_ENS_RESOLUTION_TIMEOUT_MS || '5000', 10);
const IPFS_GATEWAY_TIMEOUT_MS = parseInt(import.meta.env.VITE_IPFS_GATEWAY_TIMEOUT_MS || '10000', 10);

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EnsResolutionResult {
    address: Address;
    name: string;
    avatar?: string | null;
    contentHash?: string | null;
    ipfsHash?: string | null;
    ipfsUrl?: string | null;
}

export interface EnsTextRecord {
    key: string;
    value: string | null;
}

export enum EnsErrorCode {
    INVALID_NAME = 'INVALID_NAME',
    NAME_NOT_FOUND = 'NAME_NOT_FOUND',
    NETWORK_ERROR = 'NETWORK_ERROR',
    TIMEOUT = 'TIMEOUT',
    UNSUPPORTED_NETWORK = 'UNSUPPORTED_NETWORK',
    INVALID_CONTENT_HASH = 'INVALID_CONTENT_HASH',
    UNKNOWN = 'UNKNOWN',
}

export class EnsResolverError extends Error {
    constructor(
        message: string,
        public code: EnsErrorCode,
        public details?: unknown
    ) {
        super(message);
        this.name = 'EnsResolverError';
    }
}

// ─── Public Client Cache ────────────────────────────────────────────────────

const clientCache = new Map<number, PublicClient>();

function getPublicClient(chainId: number = mainnet.id): PublicClient {
    if (!clientCache.has(chainId)) {
        const chain = chainId === mainnet.id ? mainnet : sepolia;
        const client = createPublicClient({
            chain,
            transport: http(),
        }) as PublicClient;
        clientCache.set(chainId, client);
    }
    return clientCache.get(chainId)!;
}

// ─── Validation Functions ───────────────────────────────────────────────────

/**
 * Validates ENS name format.
 * @throws {EnsResolverError} if name is invalid
 */
export function validateEnsName(name: string): void {
    if (!name || typeof name !== 'string') {
        throw new EnsResolverError(
            'ENS name must be a non-empty string',
            EnsErrorCode.INVALID_NAME
        );
    }

    const trimmed = name.trim();
    if (!trimmed) {
        throw new EnsResolverError(
            'ENS name cannot be empty or whitespace only',
            EnsErrorCode.INVALID_NAME
        );
    }

    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*\s]/;
    if (invalidChars.test(trimmed)) {
        throw new EnsResolverError(
            'ENS name contains invalid characters',
            EnsErrorCode.INVALID_NAME
        );
    }

    // Must have a TLD (top-level domain like .eth)
    if (!trimmed.includes('.')) {
        throw new EnsResolverError(
            'ENS name must include a domain extension (e.g., .eth)',
            EnsErrorCode.INVALID_NAME
        );
    }

    // Check for consecutive dots
    if (trimmed.includes('..')) {
        throw new EnsResolverError(
            'ENS name cannot contain consecutive dots',
            EnsErrorCode.INVALID_NAME
        );
    }

    // Cannot start or end with a dot
    if (trimmed.startsWith('.') || trimmed.endsWith('.')) {
        throw new EnsResolverError(
            'ENS name cannot start or end with a dot',
            EnsErrorCode.INVALID_NAME
        );
    }
}

/**
 * Normalizes an ENS name according to ENSIP-15.
 * @throws {EnsResolverError} if normalization fails
 */
export function normalizeEnsName(name: string): string {
    try {
        validateEnsName(name);
        return normalize(name.trim());
    } catch (error) {
        if (error instanceof EnsResolverError) {
            throw error;
        }
        throw new EnsResolverError(
            `Failed to normalize ENS name: ${error instanceof Error ? error.message : 'Unknown error'}`,
            EnsErrorCode.INVALID_NAME,
            error
        );
    }
}

// ─── Core Resolution Functions ──────────────────────────────────────────────

/**
 * Resolves an ENS name to an Ethereum address.
 * 
 * @param name - ENS name to resolve (e.g., "vitalik.eth")
 * @param chainId - Chain ID (default: mainnet)
 * @returns Resolved Ethereum address
 * @throws {EnsResolverError} on resolution failure
 */
export async function resolveEnsName(
    name: string,
    chainId: number = mainnet.id
): Promise<Address> {
    const normalized = normalizeEnsName(name);
    const client = getPublicClient(chainId);

    try {
        const address = await Promise.race([
            client.getEnsAddress({ name: normalized as `${string}.eth` }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), DEFAULT_TIMEOUT_MS)
            ),
        ]);

        if (!address) {
            throw new EnsResolverError(
                `ENS name "${normalized}" does not resolve to an address`,
                EnsErrorCode.NAME_NOT_FOUND
            );
        }

        return address;
    } catch (error) {
        if (error instanceof EnsResolverError) {
            throw error;
        }

        if (error instanceof Error) {
            if (error.message === 'Timeout') {
                throw new EnsResolverError(
                    `ENS resolution timed out after ${DEFAULT_TIMEOUT_MS}ms`,
                    EnsErrorCode.TIMEOUT,
                    error
                );
            }

            // Network-related errors
            if (
                error.message.includes('fetch') ||
                error.message.includes('network') ||
                error.message.includes('ECONNREFUSED')
            ) {
                throw new EnsResolverError(
                    'Network error during ENS resolution. Please check your connection.',
                    EnsErrorCode.NETWORK_ERROR,
                    error
                );
            }
        }

        throw new EnsResolverError(
            `Failed to resolve ENS name: ${error instanceof Error ? error.message : 'Unknown error'}`,
            EnsErrorCode.UNKNOWN,
            error
        );
    }
}

/**
 * Gets ENS avatar for a name.
 * 
 * @param name - ENS name
 * @param chainId - Chain ID
 * @returns Avatar URL or null if not set
 */
export async function resolveEnsAvatar(
    name: string,
    chainId: number = mainnet.id
): Promise<string | null> {
    const normalized = normalizeEnsName(name);
    const client = getPublicClient(chainId);

    try {
        const avatar = await Promise.race([
            client.getEnsAvatar({ name: normalized as `${string}.eth` }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), DEFAULT_TIMEOUT_MS)
            ),
        ]);

        return avatar;
    } catch (error) {
        // Avatar is optional, return null on error
        console.warn(`Failed to resolve ENS avatar for ${normalized}:`, error);
        return null;
    }
}

/**
 * Gets an arbitrary text record from ENS.
 * 
 * @param name - ENS name
 * @param key - Text record key (e.g., "url", "description", "com.github")
 * @param chainId - Chain ID
 * @returns Text record value or null if not set
 */
export async function resolveEnsText(
    name: string,
    key: string,
    chainId: number = mainnet.id
): Promise<string | null> {
    const normalized = normalizeEnsName(name);
    const client = getPublicClient(chainId);

    try {
        const text = await Promise.race([
            client.getEnsText({ name: normalized as `${string}.eth`, key }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), DEFAULT_TIMEOUT_MS)
            ),
        ]);

        return text;
    } catch (error) {
        console.warn(`Failed to resolve ENS text record "${key}" for ${normalized}:`, error);
        return null;
    }
}

// ─── IPFS Functions ─────────────────────────────────────────────────────────

/**
 * Extracts IPFS hash from ENS content hash.
 * Supports both CIDv0 (Qm...) and CIDv1 formats.
 * 
 * @param contentHash - Raw content hash from ENS
 * @returns IPFS hash or null if not IPFS content
 */
export function extractIpfsHash(contentHash: string | null): string | null {
    if (!contentHash) return null;

    // Handle ipfs:// protocol
    if (contentHash.startsWith('ipfs://')) {
        return contentHash.replace('ipfs://', '');
    }

    // Handle /ipfs/ path
    if (contentHash.startsWith('/ipfs/')) {
        return contentHash.replace('/ipfs/', '');
    }

    // Check if it's already a valid IPFS hash (starts with Qm for CIDv0 or b for CIDv1)
    if (contentHash.match(/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[A-Za-z2-7]{58})$/)) {
        return contentHash;
    }

    // Try to decode from hex if it looks like encoded data
    if (contentHash.startsWith('0x') || /^[0-9a-f]+$/i.test(contentHash)) {
        try {
            // Remove 0x prefix if present
            const hex = contentHash.replace(/^0x/, '');

            // IPFS content hash in ENS is stored as:
            // - First byte: codec (0xe3 for IPFS, 0xe4 for Swarm)
            // - Second byte: hash function (0x01 for SHA2-256)
            // - Third byte: length
            // - Rest: the hash

            if (hex.startsWith('e301')) {
                // This is an IPFS content hash
                const hashBytes = hex.slice(6); // Skip codec, hash func, length

                // Convert to CIDv0 (base58btc encoded multihash)
                // For simplicity, we'll construct the ipfs:// URL
                return `ipfs://${hashBytes}`;
            }
        } catch (error) {
            console.warn('Failed to decode IPFS hash from hex:', error);
        }
    }

    return null;
}

/**
 * Gets IPFS content hash from ENS name.
 * 
 * @param name - ENS name
 * @param chainId - Chain ID
 * @returns IPFS hash or null if not set
 */
export async function getIpfsContentHash(
    name: string,
    chainId: number = mainnet.id
): Promise<string | null> {
    const normalized = normalizeEnsName(name);
    const client = getPublicClient(chainId);

    try {
        // Try to get content hash directly
        const contentHash = await Promise.race([
            client.getEnsText({ name: normalized as `${string}.eth`, key: 'contentHash' }),
            new Promise<string | null>((resolve) =>
                setTimeout(() => resolve(null), DEFAULT_TIMEOUT_MS)
            ),
        ]);

        if (contentHash) {
            const ipfsHash = extractIpfsHash(contentHash);
            if (ipfsHash) return ipfsHash;
        }

        // Fallback: try common text record keys for IPFS
        const ipfsText = await resolveEnsText(name, 'ipfs', chainId);
        if (ipfsText) {
            const ipfsHash = extractIpfsHash(ipfsText);
            if (ipfsHash) return ipfsHash;
        }

        return null;
    } catch (error) {
        console.warn(`Failed to get IPFS content hash for ${normalized}:`, error);
        return null;
    }
}

/**
 * Converts IPFS hash to a gateway URL.
 * 
 * @param hash - IPFS hash (with or without ipfs:// prefix)
 * @param gateway - IPFS gateway URL (default: configured gateway)
 * @returns Full IPFS gateway URL
 */
export function ipfsHashToGatewayUrl(
    hash: string,
    gateway: string = DEFAULT_IPFS_GATEWAY
): string {
    const cleanHash = hash.replace(/^ipfs:\/\//, '').replace(/^\/ipfs\//, '');
    const cleanGateway = gateway.replace(/\/$/, '');
    return `${cleanGateway}/ipfs/${cleanHash}`;
}

/**
 * Validates an IPFS hash format.
 * 
 * @param hash - IPFS hash to validate
 * @returns true if valid, false otherwise
 */
export function isValidIpfsHash(hash: string): boolean {
    if (!hash) return false;

    const cleanHash = hash.replace(/^ipfs:\/\//, '').replace(/^\/ipfs\//, '');

    // CIDv0: Qm followed by 44 base58 characters
    const cidv0Regex = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;

    // CIDv1: b followed by 58 base32 characters (simplified check)
    const cidv1Regex = /^b[A-Za-z2-7]{58}$/;

    return cidv0Regex.test(cleanHash) || cidv1Regex.test(cleanHash);
}

// ─── High-Level Resolution ──────────────────────────────────────────────────

/**
 * Comprehensive ENS resolution including address, avatar, and IPFS content.
 * 
 * @param name - ENS name to resolve
 * @param chainId - Chain ID
 * @returns Complete resolution result
 * @throws {EnsResolverError} if name resolution fails
 */
export async function resolveEns(
    name: string,
    chainId: number = mainnet.id
): Promise<EnsResolutionResult> {
    const normalized = normalizeEnsName(name);

    // Resolve address (required)
    const address = await resolveEnsName(normalized, chainId);

    // Resolve optional fields in parallel
    const [avatar, contentHash] = await Promise.all([
        resolveEnsAvatar(normalized, chainId),
        getIpfsContentHash(normalized, chainId),
    ]);

    const ipfsHash = contentHash ? extractIpfsHash(contentHash) : null;
    const ipfsUrl = ipfsHash && isValidIpfsHash(ipfsHash)
        ? ipfsHashToGatewayUrl(ipfsHash)
        : null;

    return {
        address,
        name: normalized,
        avatar,
        contentHash,
        ipfsHash,
        ipfsUrl,
    };
}

/**
 * Gets reverse ENS resolution (address to ENS name).
 * 
 * @param address - Ethereum address
 * @param chainId - Chain ID
 * @returns ENS name or null if not set
 */
export async function getEnsName(
    address: Address,
    chainId: number = mainnet.id
): Promise<string | null> {
    const client = getPublicClient(chainId);

    try {
        const name = await Promise.race([
            client.getEnsName({ address }),
            new Promise<null>((resolve) =>
                setTimeout(() => resolve(null), DEFAULT_TIMEOUT_MS)
            ),
        ]);

        return name;
    } catch (error) {
        console.warn(`Failed to get ENS name for address ${address}:`, error);
        return null;
    }
}
