/**
 * Custom hook for fetching multiple ENS text records
 * Based on ENS documentation: https://docs.ens.domains/web/records
 *
 * Uses viem public client directly (no wagmi dependency).
 */

import { useQuery } from '@tanstack/react-query';
import { normalize } from 'viem/ens';
import { publicClient } from '@/lib/viemClient';

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

    const { data, isLoading, error } = useQuery<TextRecord[], Error>({
        queryKey: ['ens-texts', normalizedName, keys],
        queryFn: async () => {
            const results = await Promise.all(
                keys.map(async (key) => {
                    try {
                        const value = await publicClient.getEnsText({
                            name: normalize(normalizedName),
                            key,
                        });
                        return { key, value };
                    } catch {
                        return { key, value: null };
                    }
                }),
            );
            return results;
        },
        enabled: !!normalizedName && keys.length > 0,
        staleTime: 2 * 60 * 1000,
        gcTime: 5 * 60 * 1000,
    });

    return {
        data,
        isLoading,
        error: error ?? null,
    };
}
