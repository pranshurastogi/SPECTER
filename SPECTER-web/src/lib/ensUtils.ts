/**
 * ENS Utilities
 * 
 * Helper functions for ENS operations using wagmi and viem.
 * No external dependencies needed - uses existing project dependencies.
 */

import { normalize } from 'viem/ens';

const DEFAULT_IPFS_GATEWAY = import.meta.env.VITE_IPFS_GATEWAY || 'https://ipfs.io';

// ─── IPFS Utilities ─────────────────────────────────────────────────────────

/**
 * Extracts IPFS hash from ENS content hash or various IPFS URL formats
 */
export function extractIpfsHash(contentHash: string | null | undefined): string | null {
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
    if (contentHash.match(/^(Qm[1-9A-HJ-NP-Za-km-z]{44,}|b[A-Za-z2-7]{58,})$/)) {
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
                // This is an IPFS content hash, return as-is for now
                // Full CID decoding would require multiformats package
                return contentHash;
            }
        } catch (error) {
            console.warn('Failed to decode IPFS hash from hex:', error);
        }
    }

    return null;
}

/**
 * Converts IPFS hash to gateway URL
 */
export function ipfsToGatewayUrl(
    hash: string,
    gateway: string = DEFAULT_IPFS_GATEWAY
): string {
    const cleanHash = hash.replace(/^ipfs:\/\//, '').replace(/^\/ipfs\//, '');
    const cleanGateway = gateway.replace(/\/$/, '');
    return `${cleanGateway}/ipfs/${cleanHash}`;
}

/**
 * Validates IPFS CID format (basic validation)
 */
export function isValidIpfsCid(cid: string): boolean {
    if (!cid) return false;

    const cleanCid = cid.replace(/^ipfs:\/\//, '').replace(/^\/ipfs\//, '').trim();

    // CIDv0: Qm followed by 44+ base58 characters
    const cidv0Regex = /^Qm[1-9A-HJ-NP-Za-km-z]{44,}$/;

    // CIDv1: b followed by 58+ base32 characters (simplified check)
    const cidv1Regex = /^b[A-Za-z2-7]{58,}$/;

    return cidv0Regex.test(cleanCid) || cidv1Regex.test(cleanCid);
}

// ─── ENS Name Validation ────────────────────────────────────────────────────

/**
 * Validates and normalizes an ENS name
 */
export function validateAndNormalizeEnsName(name: string): {
    valid: boolean;
    normalized?: string;
    error?: string;
} {
    try {
        if (!name || typeof name !== 'string') {
            return { valid: false, error: 'ENS name must be a non-empty string' };
        }

        const trimmed = name.trim();
        if (!trimmed) {
            return { valid: false, error: 'ENS name cannot be empty' };
        }

        // Ensure it has a TLD
        const withTld = trimmed.includes('.') ? trimmed : `${trimmed}.eth`;

        // Normalize using viem
        const normalized = normalize(withTld);

        return { valid: true, normalized };
    } catch (error) {
        return {
            valid: false,
            error: error instanceof Error ? error.message : 'Invalid ENS name format',
        };
    }
}

// ─── Formatting Utilities ───────────────────────────────────────────────────

/**
 * Formats an Ethereum address for display
 */
export function formatAddress(address: string | undefined, chars = 4): string {
    if (!address) return '';
    return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Truncates a long string (like IPFS hashes) for display
 */
export function truncateString(str: string, startChars = 10, endChars = 8): string {
    if (str.length <= startChars + endChars) return str;
    return `${str.slice(0, startChars)}...${str.slice(-endChars)}`;
}

// ─── ENS Record Constants ───────────────────────────────────────────────────

export interface TextRecordKey {
    key: string;
    label: string;
    icon?: string;
}

export const COMMON_TEXT_RECORDS: TextRecordKey[] = [
    { key: 'email', label: 'Email', icon: '📧' },
    { key: 'url', label: 'Website', icon: '🌐' },
    { key: 'description', label: 'Description', icon: '📝' },
    { key: 'notice', label: 'Notice', icon: '⚠️' },
    { key: 'keywords', label: 'Keywords', icon: '🏷️' },
    { key: 'com.twitter', label: 'Twitter', icon: '🐦' },
    { key: 'com.github', label: 'GitHub', icon: '💻' },
    { key: 'com.discord', label: 'Discord', icon: '💬' },
    { key: 'org.telegram', label: 'Telegram', icon: '📱' },
];
