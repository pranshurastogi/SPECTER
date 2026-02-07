import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { isEthereumWallet } from "@dynamic-labs/ethereum";
import { useQuery } from "@tanstack/react-query";
import { publicClient } from "@/lib/viemClient";
import { chain, useTestnet } from "@/lib/chainConfig";
import { setEnsTextRecord } from "@/lib/ensSetText";
import { setSuinsContentHash } from "@/lib/suinsSetContent";
import {
  useCurrentAccount,
  useDisconnectWallet,
  useSuiClient,
  useSignAndExecuteTransaction,
  ConnectModal,
} from "@mysten/dapp-kit";
import { SuinsClient } from "@mysten/suins";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Key,
  Lock,
  AlertTriangle,
  ArrowRight,
  Loader2,
  Upload,
  ExternalLink,
  Info,
  Download,
  CheckCircle2,
  Globe,
  Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "@/components/ui/sonner";
import { CopyButton } from "@/components/ui/copy-button";
import { DownloadJsonButton } from "@/components/ui/download-json-button";
import { TooltipLabel } from "@/components/ui/tooltip-label";
import { api, ApiError, type GenerateKeysResponse } from "@/lib/api";
import { formatAddress } from "@/lib/utils";

type SetupStep = 1 | 2 | 3 | 4;

const securityTips = [
  { icon: Lock, text: "Your keys, your control" },
  { icon: Download, text: "Backup securely offline" },
  { icon: AlertTriangle, text: "Never share private keys" },
];

export default function GenerateKeys() {
  const [currentStep, setCurrentStep] = useState<SetupStep>(1);
  const [step1Status, setStep1Status] = useState<"idle" | "generating" | "complete">("idle");
  const [keys, setKeys] = useState<GenerateKeysResponse | null>(null);
  const [ensUploading, setEnsUploading] = useState(false);
  const [ensTxHash, setEnsTxHash] = useState<string | null>(null);
  const [ensUploadResult, setEnsUploadResult] = useState<{ cid: string; text_record: string; ensName: string } | null>(null);

  // SuiNS state
  const [suinsUploading, setSuinsUploading] = useState(false);
  const [suinsTxDigest, setSuinsTxDigest] = useState<string | null>(null);
  const [suinsUploadResult, setSuinsUploadResult] = useState<{ cid: string; text_record: string; suinsName: string } | null>(null);
  const [suinsConnectOpen, setSuinsConnectOpen] = useState(false);

  // EVM wallet (Dynamic Labs)
  const { primaryWallet, setShowAuthFlow, handleLogOut } = useDynamicContext();
  const evmAddress = primaryWallet?.address as `0x${string}` | undefined;
  const evmConnected = !!primaryWallet;

  const { data: primaryEnsName, isLoading: fetchingEns } = useQuery({
    queryKey: ["ens-name-from-address", evmAddress],
    queryFn: () => publicClient.getEnsName({ address: evmAddress! }),
    enabled: !!evmAddress,
    staleTime: 2 * 60 * 1000,
  });

  // Sui wallet (dapp-kit)
  const suiAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutate: disconnectSui } = useDisconnectWallet();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const suiAddress = suiAccount?.address;
  const suiConnected = !!suiAccount;
  const suiNetwork = useTestnet ? "testnet" : "mainnet";

  // Query SuiNS names for connected Sui wallet
  const { data: suiNamesData, isLoading: fetchingSuiNames } = useQuery({
    queryKey: ["suins-names", suiAddress],
    queryFn: () => suiClient.resolveNameServiceNames({ address: suiAddress! }),
    enabled: !!suiAddress,
    staleTime: 2 * 60 * 1000,
  });
  const suiNames = suiNamesData?.data ?? [];
  const primarySuiName = suiNames[0] ?? null;

  const handleGenerate = async () => {
    setStep1Status("generating");
    setKeys(null);
    setEnsUploadResult(null);
    setSuinsUploadResult(null);
    try {
      const response = await api.generateKeys();
      setKeys(response);
      setStep1Status("complete");
      toast.success("Keys generated successfully");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to generate keys";
      toast.error(message);
      setStep1Status("idle");
    }
  };

  const handleAttachToEns = async () => {
    if (!keys?.meta_address) return;
    const ensName = primaryEnsName || "";
    if (!ensName) {
      toast.error("No ENS name found for your wallet");
      return;
    }
    if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
      toast.error("Connect an Ethereum wallet to set the ENS record");
      return;
    }
    setEnsUploading(true);
    setEnsUploadResult(null);
    setEnsTxHash(null);
    try {
      // 1. Upload meta-address to IPFS (backend)
      const res = await api.uploadIpfs({
        meta_address: keys.meta_address,
        name: `${ensName.replace(/\.eth$/i, "")}.eth-specter-profile`,
      });
      const textRecordValue = res.text_record; // ipfs://<CID>

      // 2. Sign tx to set ENS text record
      const walletClient = await primaryWallet.getWalletClient(chain.id.toString());
      const account = walletClient?.account;
      if (!walletClient || !account?.address) {
        toast.error("Could not get wallet. Please try again.");
        return;
      }
      const txHash = await setEnsTextRecord({
        ensName,
        value: textRecordValue,
        walletClient,
        publicClient,
        account: account.address,
      });

      setEnsTxHash(txHash);
      toast.info("Transaction submitted. Waiting for confirmation…");

      // 3. Wait for tx confirmation
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      setEnsUploadResult({ cid: res.cid, text_record: textRecordValue, ensName });
      setEnsTxHash(null);
      toast.success("Meta address attached to ENS.");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Attach failed";
      toast.error(message);
      setEnsTxHash(null);
    } finally {
      setEnsUploading(false);
    }
  };

  const handleAttachToSuins = async () => {
    if (!keys?.meta_address) return;
    if (!primarySuiName) {
      toast.error("No SuiNS name found for your wallet");
      return;
    }
    if (!suiAccount) {
      toast.error("Connect a Sui wallet first");
      return;
    }
    setSuinsUploading(true);
    setSuinsUploadResult(null);
    setSuinsTxDigest(null);
    try {
      // 1. Upload meta-address to IPFS (backend)
      const res = await api.uploadIpfs({
        meta_address: keys.meta_address,
        name: `${primarySuiName.replace(/\.sui$/i, "")}.sui-specter-profile`,
      });
      const textRecordValue = res.text_record; // ipfs://<CID>

      // 2. Get name record for NFT ID
      const suinsClient = new SuinsClient({ client: suiClient, network: suiNetwork });
      const nameRecord = await suinsClient.getNameRecord(primarySuiName);
      if (!nameRecord?.nftId) {
        toast.error("Could not find SuiNS name record NFT");
        return;
      }

      // 3. Set contentHash on-chain
      const digest = await setSuinsContentHash({
        suinsName: primarySuiName,
        nftId: nameRecord.nftId,
        value: textRecordValue,
        suiClient,
        network: suiNetwork,
        signAndExecute: (args) => signAndExecute({ transaction: args.transaction }),
      });

      setSuinsTxDigest(digest);
      toast.info("Transaction submitted. Waiting for confirmation…");

      // 4. Wait for tx confirmation
      await suiClient.waitForTransaction({ digest });

      setSuinsUploadResult({ cid: res.cid, text_record: textRecordValue, suinsName: primarySuiName });
      setSuinsTxDigest(null);
      toast.success("Meta address attached to SuiNS.");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Attach failed";
      toast.error(message);
      setSuinsTxDigest(null);
    } finally {
      setSuinsUploading(false);
    }
  };

  const keysJson = keys
    ? {
        spending_pk: keys.spending_pk,
        spending_sk: keys.spending_sk,
        viewing_pk: keys.viewing_pk,
        viewing_sk: keys.viewing_sk,
        meta_address: keys.meta_address,
        view_tag: keys.view_tag,
      }
    : null;

  const steps: { num: SetupStep; label: string }[] = [
    { num: 1, label: "Generate keys" },
    { num: 2, label: "Attach to ENS" },
    { num: 3, label: "Attach to SuiNS" },
    { num: 4, label: "All done" },
  ];

  const canProceedFromStep1 = step1Status === "complete" && keys != null;
  const ensCompleted = ensUploadResult != null;
  const suinsCompleted = suinsUploadResult != null;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 pt-48 pb-12 flex flex-col items-center">
        <div className="w-full max-w-lg mx-auto px-4 flex flex-col items-center">
          <div className="text-center mb-8">
            <h1 className="font-display text-2xl md:text-3xl font-bold text-foreground">
              Setup
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Quantum-safe SPECTER identity for private payments
            </p>
          </div>

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mb-8">
            {steps.map((s, i) => (
              <div key={s.num} className="flex items-center">
                <button
                  type="button"
                  onClick={() => {
                    if (s.num === 1 || (s.num >= 2 && canProceedFromStep1)) {
                      setCurrentStep(s.num);
                    }
                  }}
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                    currentStep === s.num
                      ? "bg-primary text-primary-foreground"
                      : s.num < currentStep
                        ? "bg-primary/20 text-primary"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {s.num}
                </button>
                {i < steps.length - 1 && (
                  <div className={`w-8 h-0.5 mx-0.5 ${s.num < currentStep ? "bg-primary/30" : "bg-muted"}`} />
                )}
              </div>
            ))}
          </div>

          <Card className="w-full border-border bg-card/50 shadow-lg rounded-xl overflow-hidden">
            <CardContent className="p-6 md:p-8">
              <AnimatePresence mode="wait">
                {/* ─── Step 1: Generate keys ───────────────────────────────────── */}
                {currentStep === 1 && (
                  <motion.div
                    key="step1"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className="space-y-5"
                  >
                    <h2 className="font-display text-lg font-semibold text-foreground">
                      Step 1 — Generate keys
                    </h2>

                    {step1Status === "idle" && (
                      <div className="flex flex-col items-center text-center">
                        <div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5">
                          <Key className="h-7 w-7 text-primary" />
                        </div>
                        <p className="text-sm text-muted-foreground mb-6 max-w-sm">
                          Generate a new set of cryptographic keys for receiving private payments.
                        </p>
                        <Button variant="quantum" size="lg" onClick={handleGenerate}>
                          Generate Keys
                        </Button>
                      </div>
                    )}

                    {step1Status === "generating" && (
                      <div className="flex flex-col items-center py-8">
                        <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
                        <p className="text-sm text-muted-foreground">Generating keys…</p>
                      </div>
                    )}

                    {step1Status === "complete" && keys && (
                      <div className="space-y-5">
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-success/10 border border-success/20">
                          <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                          <span className="text-sm font-medium text-success">Keys generated</span>
                        </div>

                        <div className="flex gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
                          <p className="text-sm text-amber-800 dark:text-amber-200">
                            Store this file safely. You need it to scan and claim payments. Once lost, it cannot be recovered.
                          </p>
                        </div>

                        {keysJson && (
                          <DownloadJsonButton
                            data={keysJson}
                            filename="specter-keys.json"
                            label="Download keys (backup securely)"
                            className="w-full"
                            tooltip="Keep this file safe and never share it"
                          />
                        )}

                        <div className="p-3 rounded-lg bg-muted/40 border border-border">
                          <div className="flex items-center gap-2 mb-1">
                            <TooltipLabel
                              label="Meta-address"
                              tooltip="Share this with others so they can send you private payments. Safe to share."
                              className="text-xs font-medium"
                            />
                          </div>
                          <code className="text-xs text-muted-foreground break-all block">
                            {keys.meta_address.slice(0, 48)}...
                          </code>
                          <div className="flex items-center gap-2 mt-2">
                            <CopyButton
                              text={keys.meta_address}
                              variant="outline"
                              size="sm"
                              showLabel={true}
                              label="Copy"
                              successMessage="Copied"
                            />
                          </div>
                          <div className="flex gap-2 p-2.5 mt-2 rounded-lg bg-primary/5 border border-primary/10">
                            <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                            <p className="text-xs text-muted-foreground">
                              Safe to share: give this to anyone who wants to send you private payments.
                            </p>
                          </div>
                        </div>

                        <Button variant="quantum" className="w-full" onClick={() => setCurrentStep(2)}>
                          Continue
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </motion.div>
                )}

                {/* ─── Step 2: Attach to ENS (optional) ───────────────────────── */}
                {currentStep === 2 && (
                  <motion.div
                    key="step2"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className="space-y-5"
                  >
                    <h2 className="font-display text-lg font-semibold text-foreground">
                      Step 2 — Attach to ENS
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Connect your wallet to link your ENS name to your meta-address.
                    </p>

                    {!evmConnected ? (
                      <div className="flex flex-col gap-3">
                        <Button
                          variant="outline"
                          size="lg"
                          className="w-full"
                          onClick={() => setShowAuthFlow(true)}
                        >
                          <Wallet className="h-4 w-4 mr-2" />
                          Connect Ethereum wallet
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full text-muted-foreground"
                          onClick={() => setCurrentStep(3)}
                        >
                          Skip
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-2 p-3 rounded-lg bg-muted/40 border border-border">
                          <div className="flex items-center gap-2 min-w-0">
                            <Wallet className="h-4 w-4 text-primary shrink-0" />
                            <span className="text-sm font-mono text-foreground truncate">
                              {evmAddress && formatAddress(evmAddress)}
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                            onClick={() => handleLogOut()}
                          >
                            Disconnect
                          </Button>
                        </div>

                        {fetchingEns ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Fetching ENS name…
                          </div>
                        ) : primaryEnsName ? (
                          <div className="space-y-3">
                            <p className="text-sm">
                              ENS name: <span className="font-mono font-medium text-primary">{primaryEnsName}</span>
                            </p>
                            {!ensUploadResult ? (
                              <div className="space-y-2">
                                {ensTxHash ? (
                                  <div className="p-3 rounded-lg bg-muted/50 border border-muted flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                                    <p className="text-sm">Waiting for transaction confirmation…</p>
                                  </div>
                                ) : (
                                  <>
                                    <Button
                                      variant="quantum"
                                      size="default"
                                      onClick={handleAttachToEns}
                                      disabled={ensUploading}
                                      className="w-full"
                                    >
                                      {ensUploading ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <>
                                          <Upload className="h-4 w-4 mr-2" />
                                          Attach to ENS
                                        </>
                                      )}
                                    </Button>
                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Info className="h-3 w-3 shrink-0" />
                                      Meta address is uploaded to IPFS and attached to ENS as a text record.
                                    </p>
                                  </>
                                )}
                              </div>
                            ) : (
                              <div className="p-3 rounded-lg bg-success/10 border border-success/20">
                                <p className="text-xs font-medium text-success mb-2 flex items-center gap-1.5">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Meta address attached to ENS.
                                </p>
                                <Button variant="outline" size="sm" className="w-full" asChild>
                                  <a
                                    href={useTestnet ? `https://sepolia.app.ens.domains/${encodeURIComponent(ensUploadResult.ensName)}` : `https://app.ens.domains/${encodeURIComponent(ensUploadResult.ensName)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center justify-center gap-1.5"
                                  >
                                    <Globe className="h-3.5 w-3.5" />
                                    Open ENS App
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                </Button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No ENS name found. Connect a wallet with an ENS name.
                          </p>
                        )}

                        <div className="flex gap-3">
                          <Button variant="outline" className="flex-1" onClick={() => setCurrentStep(1)}>
                            Back
                          </Button>
                          <Button variant="quantum" className="flex-1" onClick={() => setCurrentStep(3)}>
                            {ensCompleted ? "Continue" : "Skip"}
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}

                {/* ─── Step 3: Attach to SuiNS ─────────────────────────────── */}
                {currentStep === 3 && (
                  <motion.div
                    key="step3"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className="space-y-5"
                  >
                    <h2 className="font-display text-lg font-semibold text-foreground">
                      Step 3 — Attach to SuiNS
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Connect a Sui wallet to link your SuiNS name to your meta-address.
                    </p>

                    {!suiConnected ? (
                      <div className="flex flex-col gap-3">
                        <ConnectModal
                          trigger={
                            <Button
                              variant="outline"
                              size="lg"
                              className="w-full"
                              onClick={() => setSuinsConnectOpen(true)}
                            >
                              <Wallet className="h-4 w-4 mr-2" />
                              Connect Sui wallet
                            </Button>
                          }
                          open={suinsConnectOpen}
                          onOpenChange={setSuinsConnectOpen}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full text-muted-foreground"
                          onClick={() => setCurrentStep(4)}
                        >
                          Skip
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-2 p-3 rounded-lg bg-muted/40 border border-border">
                          <div className="flex items-center gap-2 min-w-0">
                            <Wallet className="h-4 w-4 text-primary shrink-0" />
                            <span className="text-sm font-mono text-foreground truncate">
                              {suiAddress && formatAddress(suiAddress)}
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                            onClick={() => disconnectSui()}
                          >
                            Disconnect
                          </Button>
                        </div>

                        {fetchingSuiNames ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Fetching SuiNS names…
                          </div>
                        ) : primarySuiName ? (
                          <div className="space-y-3">
                            <p className="text-sm">
                              SuiNS name: <span className="font-mono font-medium text-primary">{primarySuiName}</span>
                            </p>
                            {!suinsUploadResult ? (
                              <div className="space-y-2">
                                {suinsTxDigest ? (
                                  <div className="p-3 rounded-lg bg-muted/50 border border-muted flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                                    <p className="text-sm">Waiting for transaction confirmation…</p>
                                  </div>
                                ) : (
                                  <>
                                    <Button
                                      variant="quantum"
                                      size="default"
                                      onClick={handleAttachToSuins}
                                      disabled={suinsUploading}
                                      className="w-full"
                                    >
                                      {suinsUploading ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <>
                                          <Upload className="h-4 w-4 mr-2" />
                                          Attach to SuiNS
                                        </>
                                      )}
                                    </Button>
                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Info className="h-3 w-3 shrink-0" />
                                      Meta address is uploaded to IPFS and attached to SuiNS as content hash.
                                    </p>
                                  </>
                                )}
                              </div>
                            ) : (
                              <div className="p-3 rounded-lg bg-success/10 border border-success/20">
                                <p className="text-xs font-medium text-success mb-2 flex items-center gap-1.5">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Meta address attached to SuiNS.
                                </p>
                                <Button variant="outline" size="sm" className="w-full" asChild>
                                  <a
                                    href={useTestnet ? `https://testnet.suins.io/name/${encodeURIComponent(suinsUploadResult.suinsName)}` : `https://suins.io/name/${encodeURIComponent(suinsUploadResult.suinsName)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center justify-center gap-1.5"
                                  >
                                    <Globe className="h-3.5 w-3.5" />
                                    Open SuiNS
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                </Button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No SuiNS name found. Register a name at{" "}
                            <a href="https://suins.io" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                              suins.io
                            </a>{" "}
                            first.
                          </p>
                        )}

                        <div className="flex gap-3">
                          <Button variant="outline" className="flex-1" onClick={() => setCurrentStep(2)}>
                            Back
                          </Button>
                          <Button variant="quantum" className="flex-1" onClick={() => setCurrentStep(4)}>
                            {suinsCompleted ? "Continue" : "Skip"}
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}

                {/* ─── Step 4: All done ──────────────────────────────────────── */}
                {currentStep === 4 && (
                  <motion.div
                    key="step4"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className="space-y-5"
                  >
                    <h2 className="font-display text-lg font-semibold text-foreground">
                      Step 4 — All done
                    </h2>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-success/10 border border-success/20">
                      <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                      <span className="text-sm font-medium text-success">You’re all set</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Senders can now send you private payments using:
                    </p>
                    <ul className="space-y-2 text-sm">
                      {ensUploadResult && (
                        <li className="flex items-center gap-2">
                          <Globe className="h-4 w-4 text-primary" />
                          <span className="font-mono">{ensUploadResult.ensName}</span>
                        </li>
                      )}
                      {suinsUploadResult && (
                        <li className="flex items-center gap-2">
                          <Globe className="h-4 w-4 text-primary" />
                          <span className="font-mono">{suinsUploadResult.suinsName}</span>
                        </li>
                      )}
                      <li className="flex items-center gap-2">
                        <Key className="h-4 w-4 text-primary" />
                        <span>Meta-address (hex)</span>
                      </li>
                    </ul>
                    <Button variant="quantum" className="w-full" asChild>
                      <Link to="/send">
                        Go to Send
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>

          <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            {securityTips.map((tip, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <tip.icon className="h-3.5 w-3.5 text-primary" />
                {tip.text}
              </span>
            ))}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
