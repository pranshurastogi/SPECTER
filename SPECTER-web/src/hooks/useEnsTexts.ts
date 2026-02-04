/**
 * Custom hook for fetching multiple ENS text records
 * Based on ENS documentation: https://docs.ens.domains/web/records
 */

import { useEnsText } from 'wagmi';
import { normalize } from 'viem/ens';

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

export interface UseEnsTextsProps {
    name: string;
    keys: string[];
}

export interface TextRecord {
    key: string;
    value: string | null | undefined;
}

/**
 * Hook to fetch multiple ENS text records at once
 */
export function useEnsTexts({ name, keys }: UseEnsTextsProps): {
    data: TextRecord[] | undefined;
    isLoading: boolean;
    error: Error | null;
} {
    const normalizedName = name ? normalize(name) : '';

    // Use multiple useEnsText hooks for each key
    const results = keys.map((key) => {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        return useEnsText({
            name: normalizedName as `${string}.eth`,
            key,
            chainId: 1, // Always use mainnet for ENS
        });
    });

    const isLoading = results.some((r) => r.isLoading);
    const error = results.find((r) => r.error)?.error || null;

    const data = results.map((result, index) => ({
        key: keys[index],
        value: result.data,
    }));

    return {
        data: isLoading ? undefined : data,
        isLoading,
        error,
    };
}
