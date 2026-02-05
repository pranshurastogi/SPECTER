import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAccount, useEnsName, useEnsAddress, useEnsAvatar } from "wagmi";
import { normalize } from "viem/ens";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Search,
    Wallet,
    FileText,
    Globe,
    Hash,
    User,
    Loader2,
    AlertCircle,
    Sparkles,
    RefreshCw,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { EnsInfoCard } from "@/components/ens/EnsInfoCard";
import { SetIpfsHash } from "@/components/ens/SetIpfsHash";
import { EnsStepGuide, type Step } from "@/components/ens/EnsStepGuide";
import { HeadingScramble } from "@/components/ui/heading-scramble";
import { useEnsTexts } from "@/hooks/useEnsTexts";
import { useEnsContentHash } from "@/hooks/useEnsContentHash";
import {
    COMMON_TEXT_RECORDS,
    validateAndNormalizeEnsName,
    ipfsToGatewayUrl,
} from "@/lib/ensUtils";

const STEPS: Step[] = [
    {
        id: "resolve",
        title: "Resolve ENS Name",
        description: "Enter an ENS name or fetch from your connected wallet",
        tooltip: "You can manually type an ENS name (like vitalik.eth) or click 'Fetch from Wallet' to automatically detect the ENS name associated with your connected wallet address.",
    },
    {
        id: "view",
        title: "View ENS Information",
        description: "Review all data associated with the ENS name",
        tooltip: "This shows all information linked to the ENS name including the Ethereum address it resolves to, avatar, IPFS content, text records (email, social media), and other cryptocurrency addresses.",
    },
    {
        id: "modify",
        title: "Modify Records",
        description: "Update IPFS content hash and other ENS records",
        tooltip: "If you own this ENS name, you can modify its records. This includes setting an IPFS content hash which allows decentralized website hosting, and updating text records for social profiles and contact information.",
    },
];

export default function EnsManager() {
    const { address, isConnected } = useAccount();

    const [currentStep, setCurrentStep] = useState(0);
    const [ensInput, setEnsInput] = useState("");
    const [resolvedName, setResolvedName] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Fetch primary ENS name from connected wallet
    const { data: primaryName, isLoading: fetchingPrimaryName } = useEnsName({
        address: address,
        chainId: 1,
    });

    // Fetch ENS data for resolved name
    const { data: ensAddress, isLoading: loadingAddress } = useEnsAddress({
        name: resolvedName ? normalize(resolvedName) : undefined,
        chainId: 1,
    });

    const { data: ensAvatar, isLoading: loadingAvatar } = useEnsAvatar({
        name: resolvedName ? normalize(resolvedName) : undefined,
        chainId: 1,
    });

    // Content hash comes from resolver's contenthash(), not a text record (EIP-1577)
    const { ipfsHash: contentHashIpfsHash, ipfsUrl: contentHashIpfsUrl, isLoading: loadingContentHash } = useEnsContentHash(
        resolvedName || null,
        { chainId: 1 }
    );

    // Fetch text records
    const { data: textRecords, isLoading: loadingTextRecords } = useEnsTexts({
        name: resolvedName || '',
        keys: COMMON_TEXT_RECORDS.map(r => r.key),
    });

    const isLoading = loadingAddress || loadingAvatar || loadingContentHash || loadingTextRecords;

    // Auto-advance steps based on state
    useEffect(() => {
        if (resolvedName && ensAddress && currentStep === 0) {
            setCurrentStep(1);
            STEPS[0].completed = true;
        }
    }, [resolvedName, ensAddress, currentStep]);

    const handleResolve = async () => {
        const name = ensInput.trim();
        if (!name) {
            toast.error("Please enter an ENS name");
            return;
        }

        const validation = validateAndNormalizeEnsName(name);
        if (!validation.valid) {
            setError(validation.error || "Invalid ENS name");
            toast.error(validation.error || "Invalid ENS name");
            return;
        }

        setError(null);
        setResolvedName(validation.normalized!);
        toast.success(`Resolving ${validation.normalized}...`);
    };

    const handleFetchFromWallet = () => {
        if (!isConnected || !address) {
            toast.error("Please connect your wallet first");
            return;
        }

        if (!primaryName) {
            toast.error("No ENS name found for your wallet address");
            setError("No primary ENS name set for this wallet address");
            return;
        }

        setEnsInput(primaryName);
        setResolvedName(primaryName);
        setError(null);
        toast.success(`Found and resolved ${primaryName}`);
    };

    const handleReset = () => {
        setEnsInput("");
        setResolvedName(null);
        setError(null);
        setCurrentStep(0);
        STEPS.forEach(step => step.completed = false);
    };

    // IPFS from resolver content hash
    const ipfsHash = contentHashIpfsHash ?? null;
    const ipfsUrl = contentHashIpfsUrl ?? (ipfsHash ? ipfsToGatewayUrl(ipfsHash) : null);

    // Prepare data for info cards
    const basicInfo = resolvedName && ensAddress ? [
        { label: "ENS Name", value: resolvedName, icon: "🏷️", copyable: true },
        { label: "Ethereum Address", value: ensAddress, icon: "💎", copyable: true, truncate: true },
        { label: "Avatar", value: ensAvatar, icon: "🖼️", link: ensAvatar || undefined },
    ] : [];

    const contentInfo = [
        {
            label: "IPFS Content Hash",
            value: ipfsHash,
            icon: "📦",
            copyable: true,
            link: ipfsUrl || undefined,
            truncate: true
        },
    ];

    const textRecordItems = textRecords
        ?.map((record, index) => {
            const config = COMMON_TEXT_RECORDS[index];
            return {
                label: config.label,
                value: record.value,
                icon: config.icon,
                copyable: true,
            };
        })
        .filter(item => item.value) || [];

    return (
        <div className="min-h-screen flex flex-col">
            <Header />

            <main className="flex-1 pt-24 pb-12">
                <div className="container mx-auto px-4">
                    <div className="max-w-5xl mx-auto">
                        {/* Header */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-center mb-12"
                        >
                            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-4">
                                <Sparkles className="h-4 w-4 text-primary" />
                                <span className="text-sm font-medium text-primary">ENS Management</span>
                            </div>
                            <HeadingScramble
                                as="h1"
                                className="font-display text-4xl md:text-5xl font-bold mb-4 block"
                              >
                                Manage Your ENS
                              </HeadingScramble>
                            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                                Resolve ENS names, view all associated data, and manage IPFS content hashes
                            </p>
                        </motion.div>

                        {/* Step Guide */}
                        <EnsStepGuide
                            steps={STEPS}
                            currentStep={currentStep}
                            onStepChange={setCurrentStep}
                        />

                        {/* Resolution Section */}
                        {currentStep === 0 && (
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="glass-card p-8 mb-8"
                            >
                                <h2 className="font-display text-2xl font-semibold mb-6">
                                    Resolve ENS Name
                                </h2>

                                <div className="space-y-4">
                                    <div className="flex gap-3">
                                        <Input
                                            placeholder="vitalik.eth or enter any ENS name"
                                            value={ensInput}
                                            onChange={(e) => setEnsInput(e.target.value)}
                                            onKeyDown={(e) => e.key === "Enter" && handleResolve()}
                                            className="flex-1 text-lg"
                                        />
                                        <Button
                                            onClick={handleResolve}
                                            disabled={!ensInput.trim()}
                                            size="lg"
                                        >
                                            <Search className="h-5 w-5 mr-2" />
                                            Resolve
                                        </Button>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        <div className="h-px flex-1 bg-border" />
                                        <span className="text-sm text-muted-foreground">OR</span>
                                        <div className="h-px flex-1 bg-border" />
                                    </div>

                                    <Button
                                        variant="outline"
                                        size="lg"
                                        className="w-full"
                                        onClick={handleFetchFromWallet}
                                        disabled={!isConnected || fetchingPrimaryName}
                                    >
                                        {fetchingPrimaryName ? (
                                            <>
                                                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                                Fetching from Wallet...
                                            </>
                                        ) : (
                                            <>
                                                <Wallet className="h-5 w-5 mr-2" />
                                                Fetch from Connected Wallet
                                            </>
                                        )}
                                    </Button>

                                    {!isConnected && (
                                        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 text-sm text-muted-foreground">
                                            <AlertCircle className="h-4 w-4 shrink-0" />
                                            <span>Connect your wallet to automatically fetch your ENS name</span>
                                        </div>
                                    )}

                                    {error && (
                                        <div className="flex items-center gap-2 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                                            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
                                            <p className="text-sm text-destructive">{error}</p>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        )}

                        {/* ENS Information Display */}
                        {resolvedName && currentStep >= 1 && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="space-y-6 mb-8"
                            >
                                <div className="flex items-center justify-between">
                                    <h2 className="font-display text-2xl font-semibold">
                                        ENS Information
                                    </h2>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setResolvedName(resolvedName)}
                                            disabled={isLoading}
                                        >
                                            {isLoading ? (
                                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                            ) : (
                                                <RefreshCw className="h-4 w-4 mr-2" />
                                            )}
                                            Refresh
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={handleReset}>
                                            Resolve Another
                                        </Button>
                                    </div>
                                </div>

                                <div className="grid gap-6 md:grid-cols-2">
                                    <EnsInfoCard
                                        title="Basic Information"
                                        icon={<User className="h-5 w-5 text-primary" />}
                                        items={basicInfo}
                                        loading={isLoading}
                                        tooltip="Core ENS information including name, address, and avatar"
                                    />

                                    <EnsInfoCard
                                        title="Content & IPFS"
                                        icon={<FileText className="h-5 w-5 text-accent" />}
                                        items={contentInfo}
                                        loading={loadingContentHash}
                                        tooltip="IPFS content hash for decentralized website hosting"
                                    />

                                    {textRecordItems.length > 0 && (
                                        <EnsInfoCard
                                            title="Text Records"
                                            icon={<Globe className="h-5 w-5 text-success" />}
                                            items={textRecordItems}
                                            loading={loadingTextRecords}
                                            tooltip="Social profiles, contact information, and other metadata"
                                            expandable={textRecordItems.length > 3}
                                        />
                                    )}

                                    <EnsInfoCard
                                        title="Other Addresses"
                                        icon={<Hash className="h-5 w-5 text-primary" />}
                                        items={ensAddress ? [
                                            { label: "ETH", value: ensAddress, copyable: true, truncate: true }
                                        ] : []}
                                        loading={loadingAddress}
                                        tooltip="Cryptocurrency addresses linked to this ENS name"
                                    />
                                </div>
                            </motion.div>
                        )}

                        {/* Modify Records Section */}
                        {resolvedName && ensAddress && currentStep >= 2 && (
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="space-y-6"
                            >
                                <h2 className="font-display text-2xl font-semibold">
                                    Modify ENS Records
                                </h2>

                                <SetIpfsHash
                                    ensName={resolvedName}
                                    currentHash={ipfsHash}
                                    walletAddress={address}
                                    chainId={1}
                                    onSuccess={() => setResolvedName(resolvedName)}
                                />
                            </motion.div>
                        )}
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
}
