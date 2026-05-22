import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { isEthereumWallet } from "@dynamic-labs/ethereum";
import { useQuery } from "@tanstack/react-query";
import { publicClient } from "@/lib/blockchain/viemClient";
import { chain, useTestnet } from "@/lib/blockchain/chainConfig";
import { setEnsTextRecord } from "@/lib/blockchain/ensSetText";
import { setSuinsContentHash } from "@/lib/blockchain/suinsSetContent";
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
import { HeadingScramble } from "@/components/ui/animations/heading-scramble";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import { Card, CardContent } from "@/components/ui/base/card";
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
  HardDrive,
  ShieldCheck,
  RefreshCcw,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "@/components/ui/base/sonner";
import { CopyButton } from "@/components/ui/specialized/copy-button";
import { DownloadJsonButton } from "@/components/ui/specialized/download-json-button";
import { TooltipLabel } from "@/components/ui/specialized/tooltip-label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/specialized/alert-dialog";
import { api, ApiError, type GenerateKeysResponse, type ResolveEnsResponse } from "@/lib/api";
import { saveSetupProgress, clearSetupProgress } from "@/lib/setupProgress";
import { analytics } from "@/lib/analytics";
import { formatAddress } from "@/lib/utils";
import { SaveToDeviceDialog } from "@/components/features/keys/SaveToDeviceDialog";
import { CoreSpinLoader } from "@/components/ui/core-spin-loader";
import { listVaultEntries, unlockEntry, type VaultEntry } from "@/lib/crypto/keyVault";

type SetupStep = 1 | 2 | 3 | 4;
type EnsMode = "select" | "keep" | "attach-new";

type VerifyStep = "pick-method" | "upload" | "vault" | "result";

function EnsExistingRecordPanel({
  existingRecord,
  onConfirmKeep,
  onSwitchToReplace,
  onBack,
  useTestnet,
}: {
  existingRecord: ResolveEnsResponse;
  onConfirmKeep: () => void;
  onSwitchToReplace: () => void;
  onBack: () => void;
  useTestnet: boolean;
}) {
  const [verifyStep, setVerifyStep] = useState<VerifyStep>("pick-method");
  const [result, setResult] = useState<"match" | "mismatch" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vaultEntries] = useState<VaultEntry[]>(() => listVaultEntries());
  const [selectedEntry, setSelectedEntry] = useState<string>(() => listVaultEntries()[0]?.id ?? "");
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const compare = (candidateMeta: string) => {
    setResult(candidateMeta.trim() === existingRecord.meta_address.trim() ? "match" : "mismatch");
    setVerifyStep("result");
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed.meta_address !== "string") {
        throw new Error("Invalid file — meta_address not found");
      }
      compare(parsed.meta_address);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read file");
    }
    e.target.value = "";
  };

  const onUnlock = async () => {
    if (!selectedEntry || !password) return;
    setUnlocking(true);
    setError(null);
    try {
      const decrypted = await unlockEntry(selectedEntry, password);
      compare(decrypted.meta_address);
    } catch {
      setError("Wrong password — try again");
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Always-visible: what's on ENS */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
            Meta-address on ENS
          </p>
          <code className="text-xs text-foreground break-all">
            {existingRecord.meta_address.slice(0, 20)}…{existingRecord.meta_address.slice(-10)}
          </code>
        </div>
        <a
          href={
            useTestnet
              ? `https://sepolia.app.ens.domains/${encodeURIComponent(existingRecord.ens_name)}`
              : `https://app.ens.domains/${encodeURIComponent(existingRecord.ens_name)}`
          }
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5"
        >
          <img src="/ens-logo.png" alt="ENS" className="w-3.5 h-3.5 rounded-sm object-contain opacity-70" />
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* ── Step: pick verification method ── */}
      {verifyStep === "pick-method" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">How would you like to verify ownership?</p>
          <button
            type="button"
            onClick={() => { setError(null); setVerifyStep("upload"); }}
            className="flex items-center gap-3 w-full p-3 rounded-lg border border-border bg-card hover:bg-muted/40 hover:border-primary/30 transition-colors text-left"
          >
            <Upload className="h-4 w-4 text-primary shrink-0" />
            <div>
              <p className="text-xs font-medium text-foreground">Upload key file</p>
              <p className="text-[11px] text-muted-foreground">Compare using your specter-keys.json backup</p>
            </div>
          </button>
          {vaultEntries.length > 0 ? (
            <button
              type="button"
              onClick={() => { setError(null); setVerifyStep("vault"); }}
              className="flex items-center gap-3 w-full p-3 rounded-lg border border-border bg-card hover:bg-muted/40 hover:border-primary/30 transition-colors text-left"
            >
              <HardDrive className="h-4 w-4 text-primary shrink-0" />
              <div>
                <p className="text-xs font-medium text-foreground">Use saved keys</p>
                <p className="text-[11px] text-muted-foreground">
                  {vaultEntries.length} encrypted {vaultEntries.length === 1 ? "entry" : "entries"} on this device
                </p>
              </div>
            </button>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-muted/20 text-muted-foreground">
              <HardDrive className="h-4 w-4 shrink-0 opacity-40" />
              <p className="text-[11px]">No keys saved on this device</p>
            </div>
          )}
          <button
            type="button"
            onClick={onBack}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center pt-1"
          >
            ← Back to options
          </button>
        </div>
      )}

      {/* ── Step: upload file ── */}
      {verifyStep === "upload" && (
        <div className="space-y-2">
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFileChange} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full flex flex-col items-center gap-2 p-6 rounded-lg border border-dashed border-border hover:border-primary/40 bg-muted/10 hover:bg-muted/20 transition-colors"
          >
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Click to select <span className="font-mono">specter-keys.json</span></span>
          </button>
          {error && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => { setError(null); setVerifyStep("pick-method"); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center pt-1"
          >
            ← Back
          </button>
        </div>
      )}

      {/* ── Step: vault unlock ── */}
      {verifyStep === "vault" && (
        <div className="space-y-2">
          {vaultEntries.length > 1 && (
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">Select key entry:</p>
              {vaultEntries.map((entry) => (
                <label
                  key={entry.id}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                    selectedEntry === entry.id
                      ? "border-primary/40 bg-primary/5"
                      : "border-border bg-card hover:bg-muted/30"
                  }`}
                >
                  <input
                    type="radio"
                    className="accent-primary"
                    checked={selectedEntry === entry.id}
                    onChange={() => setSelectedEntry(entry.id)}
                  />
                  <span className="text-xs font-medium text-foreground truncate">{entry.label}</span>
                  <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </span>
                </label>
              ))}
            </div>
          )}
          <Input
            type="password"
            placeholder="Vault password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === "Enter" && onUnlock()}
            autoComplete="current-password"
          />
          {error && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {error}
            </p>
          )}
          <Button
            variant="quantum"
            size="sm"
            className="w-full"
            onClick={onUnlock}
            disabled={!password || unlocking}
          >
            {unlocking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
                Unlock & compare
              </>
            )}
          </Button>
          <button
            type="button"
            onClick={() => { setError(null); setPassword(""); setVerifyStep("pick-method"); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center pt-1"
          >
            ← Back
          </button>
        </div>
      )}

      {/* ── Step: result ── */}
      {verifyStep === "result" && result === "match" && (
        <div className="space-y-2.5">
          <div className="specter-confirm">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="specter-confirm-text">Verified — these keys are yours</span>
          </div>
          <Button variant="quantum" size="sm" className="w-full" onClick={onConfirmKeep}>
            <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
            Confirmed, keep this setup
          </Button>
        </div>
      )}

      {verifyStep === "result" && result === "mismatch" && (
        <div className="space-y-2.5">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Keys don&apos;t match</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                The backup you provided differs from the ENS record. Try a different backup, or replace the record with your new keys.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => { setResult(null); setPassword(""); setError(null); setVerifyStep("pick-method"); }}
            >
              Try another
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={onSwitchToReplace}
            >
              Replace keys
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const securityTips = [
  { icon: Lock, text: "Your keys, your control" },
  { icon: Download, text: "Backup securely offline" },
  { icon: AlertTriangle, text: "Never share private keys" },
];

export default function GenerateKeys() {
  const [currentStep, setCurrentStep] = useState<SetupStep>(1);
  const [step1Status, setStep1Status] = useState<"idle" | "generating" | "complete">("idle");
  const [keys, setKeys] = useState<GenerateKeysResponse | null>(null);
  const [keysDownloaded, setKeysDownloaded] = useState(false);
  const [keySavedToDevice, setKeySavedToDevice] = useState(false);
  const [showContinueWithoutDownloadWarning, setShowContinueWithoutDownloadWarning] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [ensUploading, setEnsUploading] = useState(false);
  const [ensTxHash, setEnsTxHash] = useState<string | null>(null);
  const [ensUploadResult, setEnsUploadResult] = useState<{ cid: string; text_record: string; ensName: string } | null>(null);
  const [ensMode, setEnsMode] = useState<EnsMode>("select");

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

  const {
    data: existingEnsRecord,
    isLoading: checkingExistingEns,
    error: existingEnsCheckError,
  } = useQuery({
    queryKey: ["ens-existing-specter", primaryEnsName],
    queryFn: () => api.resolveEns(primaryEnsName!),
    enabled: !!primaryEnsName && !ensUploadResult,
    staleTime: 30 * 1000,
    retry: false,
  });

  const isNoRecordError =
    existingEnsCheckError instanceof ApiError &&
    (existingEnsCheckError.code === "NO_SPECTER_RECORD" ||
      (existingEnsCheckError.status != null && existingEnsCheckError.status >= 400 && existingEnsCheckError.status < 500));

  useEffect(() => {
    setEnsMode("select");
  }, [evmAddress, primaryEnsName]);

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
    analytics.setupGenerateClicked();
    setStep1Status("generating");
    setKeys(null);
    setKeysDownloaded(false);
    setKeySavedToDevice(false);
    setEnsUploadResult(null);
    setSuinsUploadResult(null);
    try {
      const response = await api.generateKeys();
      setKeys(response);
      setStep1Status("complete");
      saveSetupProgress({ keysGenerated: true });
      analytics.setupKeysGenerated();
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
    analytics.setupEnsAttachClicked();
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
      saveSetupProgress({ ensAttached: true });
      analytics.setupEnsAttached(ensName);
      toast.success("Meta address attached to ENS.");
    } catch (err: unknown) {
      const anyErr = err as { name?: string; code?: string } | ApiError | Error | unknown;

      let message: string;
      if ((anyErr as { name?: string }).name === "ChainMismatchError" || (anyErr as { code?: string }).code === "CHAIN_MISMATCH") {
        message = `Wrong network selected in wallet. Please switch your wallet to ${chain.name} (chain id ${chain.id}) and try again.`;
      } else if (anyErr instanceof ApiError) {
        message = anyErr.message;
      } else if (anyErr instanceof Error) {
        message = anyErr.message || "Attach failed";
      } else {
        message = "Attach failed";
      }

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
    analytics.setupSuinsAttachClicked();
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
      saveSetupProgress({ suinsAttached: true });
      analytics.setupSuinsAttached(primarySuiName);
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
            <HeadingScramble
              as="h1"
              className="font-display text-2xl md:text-3xl font-bold text-foreground"
            >
              Setup
            </HeadingScramble>
            <p className="text-sm text-muted-foreground mt-2">
              One setup. Untraceable payments. Your keys, your rules.
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
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${currentStep === s.num
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
                          Derive your stealth keypair. No one else can trace or see what&apos;s sent to you.
                        </p>
                        <Button variant="quantum" size="lg" onClick={handleGenerate}>
                          Generate Keys
                        </Button>
                      </div>
                    )}

                    {step1Status === "generating" && (
                      <CoreSpinLoader />
                    )}

                    {step1Status === "complete" && keys && (
                      <div className="space-y-5">
                        <div className="specter-confirm">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span className="specter-confirm-text">Keypair confirmed</span>
                        </div>

                        <div className="flex gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
                          <p className="text-sm text-amber-800 dark:text-amber-200">
                            Back this up. Lose it and your stealth payments are unrecoverable — no second chances.
                          </p>
                        </div>

                        {keysJson && (
                          <DownloadJsonButton
                            data={keysJson}
                            filename="specter-keys.json"
                            label="Download Keys"
                            variant="quantum"
                            size="lg"
                            className="w-full ring-2 ring-primary ring-offset-2 font-semibold shadow-md animate-in fade-in"
                            tooltip="Keep this file safe and never share it"
                            onDownload={() => { setKeysDownloaded(true); analytics.setupKeysDownloaded(); }}
                          />
                        )}

                        <div className={`relative rounded-lg overflow-hidden ${!keySavedToDevice ? "p-[1.5px]" : ""}`}>
                          {/* Snake flowing border — only when not yet saved */}
                          {!keySavedToDevice && (
                            <div
                              className="absolute w-[200%] h-[200%] top-[-50%] left-[-50%] pointer-events-none"
                              style={{
                                background: "conic-gradient(from 0deg, transparent 0%, transparent 55%, hsl(263 70% 52% / 0.9) 68%, hsl(263 70% 52% / 0.5) 74%, transparent 78%)",
                                animation: "snake-border-spin 3s linear infinite",
                              }}
                            />
                          )}
                          <Button
                            variant="outline"
                            size="default"
                            className={`relative w-full ${!keySavedToDevice ? "bg-card border-transparent hover:bg-primary/5" : ""}`}
                            onClick={() => { setShowSaveDialog(true); }}
                          >
                            <HardDrive className="h-4 w-4 mr-2" />
                            {keySavedToDevice ? "Saved to device" : "Save to this device"}
                            {!keySavedToDevice && <span className="ml-auto text-xs text-primary/70 font-medium">Recommended</span>}
                          </Button>
                        </div>

                        {keysJson && (
                          <SaveToDeviceDialog
                            open={showSaveDialog}
                            onOpenChange={setShowSaveDialog}
                            onSaved={() => { setKeySavedToDevice(true); analytics.setupKeysSavedToDevice(); }}
                            keys={{
                              spending_pk: keysJson.spending_pk,
                              spending_sk: keysJson.spending_sk,
                              viewing_pk: keysJson.viewing_pk,
                              viewing_sk: keysJson.viewing_sk,
                              meta_address: keysJson.meta_address,
                              view_tag: keysJson.view_tag,
                            }}
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
                              Your public handle — share it freely. Senders use it to reach you in stealth.
                            </p>
                          </div>
                        </div>

                        <Button
                          variant="quantum"
                          className="w-full"
                          onClick={() => {
                            if (keysDownloaded || keySavedToDevice) {
                              analytics.setupStepNavigated(2, 1);
                              setCurrentStep(2);
                            } else {
                              setShowContinueWithoutDownloadWarning(true);
                            }
                          }}

                        >
                          Continue
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>

                        <AlertDialog open={showContinueWithoutDownloadWarning} onOpenChange={setShowContinueWithoutDownloadWarning}>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>You haven&apos;t downloaded your keys</AlertDialogTitle>
                              <AlertDialogDescription>
                                Your keys file is the only backup to scan and claim payments. If you continue without downloading, you may lose access if you clear data or use another device. Download your keys now and store them safely.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Go back</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => {
                                  analytics.setupSkippedWithoutBackup();
                                  analytics.setupStepNavigated(2, 1);
                                  setCurrentStep(2);
                                  setShowContinueWithoutDownloadWarning(false);
                                }}
                                className="bg-amber-600 hover:bg-amber-700"
                              >
                                Continue anyway
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
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

                    {!evmConnected ? (
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                          Connect your Ethereum wallet to link your ENS name to your meta-address.
                        </p>
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
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div
                          className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-border/60"
                          style={{ background: "hsl(217 19% 14% / 0.6)", backdropFilter: "blur(8px)" }}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
                              style={{ background: "hsl(263 70% 52% / 0.12)", border: "1px solid hsl(263 70% 52% / 0.2)" }}
                            >
                              <Wallet className="h-3 w-3" style={{ color: "hsl(263 70% 65%)" }} />
                            </span>
                            <span className="text-xs font-mono text-foreground/80 truncate">
                              {evmAddress && formatAddress(evmAddress)}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => handleLogOut()}
                          >
                            Disconnect
                          </button>
                        </div>

                        {fetchingEns ? (
                          <div className="flex items-center gap-2.5 py-0.5">
                            <span className="flex gap-[3px] shrink-0">
                              {([0, 140, 280] as const).map((d) => (
                                <span
                                  key={d}
                                  className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce"
                                  style={{ animationDelay: `${d}ms`, animationDuration: "1s" }}
                                />
                              ))}
                            </span>
                            <span className="text-xs text-muted-foreground tracking-wide">Fetching ENS name…</span>
                          </div>
                        ) : primaryEnsName ? (
                          <div className="space-y-3">
                            {/* ENS name chip — shown when no existing record (fresh attach) or after step is complete.
                                The select/keep/attach-new sub-flows render their own context instead. */}
                            {(!existingEnsRecord || ensUploadResult) && (
                              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/15">
                                <img src="/ens-logo.png" alt="ENS" className="w-4 h-4 shrink-0 rounded-sm object-contain" />
                                <span className="text-sm font-mono text-primary">{primaryEnsName}</span>
                              </div>
                            )}
                            {/* ── Already attached this session ── */}
                            {ensUploadResult ? (
                              <div className="space-y-2">
                                <div className="specter-confirm">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  <span className="specter-confirm-text">ENS record locked in</span>
                                </div>
                                <Button variant="outline" size="sm" className="w-full" asChild>
                                  <a
                                    href={useTestnet ? `https://sepolia.app.ens.domains/${encodeURIComponent(ensUploadResult.ensName)}` : `https://app.ens.domains/${encodeURIComponent(ensUploadResult.ensName)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center justify-center gap-1.5"
                                  >
                                    <img src="/ens-logo.png" alt="ENS" className="w-3.5 h-3.5 rounded-sm object-contain shrink-0" />
                                    Open ENS App
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                </Button>
                              </div>
                            ) : checkingExistingEns ? (
                              /* ── Checking for prior setup ── */
                              <div className="flex items-center gap-2.5 py-0.5">
                                <span className="flex gap-[3px] shrink-0">
                                  {([0, 140, 280] as const).map((d) => (
                                    <span
                                      key={d}
                                      className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce"
                                      style={{ animationDelay: `${d}ms`, animationDuration: "1s" }}
                                    />
                                  ))}
                                </span>
                                <span className="text-xs text-muted-foreground tracking-wide">
                                  Checking existing setup…
                                </span>
                              </div>
                            ) : existingEnsRecord ? (
                              /* ── Prior SPECTER record found ── */
                              ensMode === "select" ? (
                                <div className="space-y-3">
                                  {/* ── Live status banner ── */}
                                  <div
                                    className="relative overflow-hidden rounded-xl border border-primary/20"
                                    style={{
                                      background: "hsl(263 70% 52% / 0.04)",
                                      boxShadow: "inset 3px 0 0 hsl(263 70% 52% / 0.35)",
                                    }}
                                  >
                                    <div className="px-4 py-3 flex items-center gap-3">
                                      {/* Pulsing live dot */}
                                      <span className="relative flex shrink-0 h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-55" />
                                        <span className="relative flex rounded-full h-2 w-2 bg-emerald-500" />
                                      </span>
                                      <div className="min-w-0 flex-1">
                                        <p
                                          className="text-[9px] font-bold tracking-[0.2em] uppercase mb-0.5"
                                          style={{ color: "hsl(263 70% 68%)", fontFamily: "var(--font-display)" }}
                                        >
                                          Active Record
                                        </p>
                                        <div className="flex items-center gap-1.5">
                                          <img src="/ens-logo.png" alt="ENS" className="w-3.5 h-3.5 rounded-sm object-contain shrink-0 opacity-80" />
                                          <p className="text-sm font-semibold text-foreground font-mono truncate">
                                            {primaryEnsName}
                                          </p>
                                        </div>
                                      </div>
                                      <ShieldCheck className="h-4 w-4 shrink-0" style={{ color: "hsl(263 70% 52% / 0.35)" }} />
                                    </div>
                                  </div>

                                  {/* ── Choice prompt ── */}
                                  <p className="text-[11px] text-muted-foreground px-0.5 leading-relaxed">
                                    A meta-address is already attached to this name. How do you want to proceed?
                                  </p>

                                  {/* ── Option cards ── */}
                                  <div className="space-y-2">
                                    {/* Keep existing — recommended */}
                                    <button
                                      type="button"
                                      onClick={() => setEnsMode("keep")}
                                      className="group relative w-full text-left rounded-xl border border-border overflow-hidden transition-all duration-200 hover:border-primary/35"
                                      style={{ background: "hsl(263 70% 52% / 0.02)" }}
                                    >
                                      {/* Hover gradient wash */}
                                      <div
                                        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                                        style={{ background: "linear-gradient(135deg, hsl(263 70% 52% / 0.07) 0%, transparent 55%)" }}
                                      />
                                      <div className="relative flex items-center gap-3 px-4 py-3.5">
                                        {/* Icon container — emerald tint */}
                                        <div
                                          className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
                                          style={{
                                            background: "hsl(142 72% 45% / 0.1)",
                                            border: "1px solid hsl(142 72% 45% / 0.22)",
                                          }}
                                        >
                                          <ShieldCheck className="h-4 w-4" style={{ color: "hsl(142 72% 58%)" }} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 mb-0.5">
                                            <span className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-display)" }}>
                                              Keep existing
                                            </span>
                                            {/* Recommended chip */}
                                            <span
                                              className="text-[9px] font-bold tracking-[0.1em] uppercase px-1.5 py-0.5 rounded-full shrink-0"
                                              style={{
                                                background: "hsl(142 72% 45% / 0.11)",
                                                color: "hsl(142 72% 62%)",
                                                border: "1px solid hsl(142 72% 45% / 0.18)",
                                              }}
                                            >
                                              Recommended
                                            </span>
                                          </div>
                                          <p className="text-[11px] text-muted-foreground leading-snug">
                                            Verify ownership and skip re-uploading
                                          </p>
                                        </div>
                                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all duration-200" />
                                      </div>
                                    </button>

                                    {/* Replace keys — secondary */}
                                    <button
                                      type="button"
                                      onClick={() => setEnsMode("attach-new")}
                                      className="group w-full text-left rounded-xl border border-border bg-card/50 hover:bg-muted/25 hover:border-border/70 transition-all duration-200"
                                    >
                                      <div className="flex items-center gap-3 px-4 py-3.5">
                                        <div className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-muted/60 border border-border">
                                          <RefreshCcw className="h-4 w-4 text-muted-foreground/70" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-medium text-foreground mb-0.5" style={{ fontFamily: "var(--font-display)" }}>
                                            Replace keys
                                          </p>
                                          <p className="text-[11px] text-muted-foreground leading-snug">
                                            Overwrite with your newly generated keys
                                          </p>
                                        </div>
                                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all duration-200" />
                                      </div>
                                    </button>
                                  </div>
                                </div>
                              ) : ensMode === "keep" ? (
                                <EnsExistingRecordPanel
                                  existingRecord={existingEnsRecord}
                                  useTestnet={useTestnet}
                                  onConfirmKeep={() => {
                                    setEnsUploadResult({
                                      cid: existingEnsRecord.ipfs_cid ?? "",
                                      text_record: existingEnsRecord.meta_address,
                                      ensName: existingEnsRecord.ens_name,
                                    });
                                    saveSetupProgress({ ensAttached: true });
                                    analytics.setupEnsRecordKept(existingEnsRecord.ens_name);
                                    toast.success("Existing ENS record confirmed.");
                                  }}
                                  onSwitchToReplace={() => setEnsMode("attach-new")}
                                  onBack={() => setEnsMode("select")}
                                />
                              ) : (
                                /* attach-new / overwrite */
                                <div className="space-y-2">
                                  <div className="flex gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                                    <p className="text-xs text-amber-700 dark:text-amber-300">
                                      This overwrites the existing record on{" "}
                                      <span className="font-mono font-medium">{primaryEnsName}</span>.
                                    </p>
                                  </div>
                                  {ensTxHash ? (
                                    <div className="p-3 rounded-lg bg-muted/50 border border-muted flex items-center gap-2">
                                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                                      <p className="text-sm">Waiting for transaction confirmation…</p>
                                    </div>
                                  ) : (
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
                                          Overwrite ENS record
                                        </>
                                      )}
                                    </Button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setEnsMode("select")}
                                    className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center py-1"
                                  >
                                    ← Back to options
                                  </button>
                                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Info className="h-3 w-3 shrink-0" />
                                    Meta address uploaded to IPFS and set as ENS text record.
                                  </p>
                                </div>
                              )
                            ) : (
                              /* ── No prior record (or check error — show attach) ── */
                              <div className="space-y-2">
                                {existingEnsCheckError && !isNoRecordError && (
                                  <div className="flex gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                                    <p className="text-xs text-amber-700 dark:text-amber-300">
                                      Could not check for existing record. You can still attach below.
                                    </p>
                                  </div>
                                )}
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
                            )}
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {/* Dark Knight themed ENS not-found card */}
                            <div className="rounded-xl overflow-hidden border border-amber-500/20 bg-black/70 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(251,191,36,0.06)]">
                              <div className="px-4 py-3 border-b border-amber-500/10 bg-amber-500/[0.04]">
                                <div className="flex items-center gap-2">
                                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/20">
                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                                  </span>
                                  <span className="font-display text-[10px] font-bold tracking-[0.18em] uppercase text-amber-400/80">
                                    No ENS Domain Detected
                                  </span>
                                </div>
                              </div>
                              <div className="px-4 py-3 space-y-3">
                                <p className="text-sm text-white/50">
                                  This wallet has no ENS name. You need one so senders can reach you via a human‑readable identifier like <span className="font-mono text-amber-400/70">yourname.eth</span>.
                                </p>
                                <a
                                  href={useTestnet ? "https://sepolia.app.ens.domains/" : "https://app.ens.domains/"}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="group flex items-center justify-center gap-2 w-full rounded-lg border border-amber-500/25 bg-amber-500/[0.08] hover:bg-amber-500/[0.14] px-4 py-2.5 text-sm font-medium text-amber-300 transition-all duration-200 hover:border-amber-500/40 hover:shadow-[0_0_16px_rgba(251,191,36,0.12)]"
                                >
                                  <Globe className="h-4 w-4 text-amber-400/70 group-hover:text-amber-400 transition-colors" />
                                  Get an ENS Domain
                                  <ExternalLink className="h-3 w-3 text-amber-400/50 group-hover:text-amber-400/80 transition-colors" />
                                </a>
                                <p className="text-[11px] text-white/25 text-center">
                                  {useTestnet ? "Sepolia testnet" : "Ethereum mainnet"} · reconnect once you have a name
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="flex gap-3">
                          <Button variant="outline" className="flex-1" onClick={() => { analytics.setupStepNavigated(1, 2); setCurrentStep(1); }}>
                            Back
                          </Button>
                          <Button variant="quantum" className="flex-1" onClick={() => { analytics.setupStepNavigated(3, 2); setCurrentStep(3); }}>
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
                          onClick={() => { clearSetupProgress(); setCurrentStep(4); }}
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
                              <div className="space-y-2">
                                <div className="specter-confirm">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  <span className="specter-confirm-text">SuiNS record locked in</span>
                                </div>
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
                            <a href={useTestnet ? "https://testnet.suins.io/" : "https://suins.io"} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                              {useTestnet ? "testnet.suins.io" : "suins.io"}
                            </a>{" "}
                            first.
                          </p>
                        )}

                        <div className="flex gap-3">
                          <Button variant="outline" className="flex-1" onClick={() => { analytics.setupStepNavigated(2, 3); setCurrentStep(2); }}>
                            Back
                          </Button>
                          <Button variant="quantum" className="flex-1" onClick={() => { clearSetupProgress(); analytics.setupStepNavigated(4, 3); analytics.setupCompleted({ ensAttached: ensCompleted, suinsAttached: suinsCompleted }); setCurrentStep(4); }}>
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
                    <div className="specter-confirm">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span className="specter-confirm-text">Identity activated — SPECTER mode on</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      You&apos;re live. Anyone can now reach you in stealth via:
                    </p>
                    <ul className="space-y-2 text-sm">
                      {ensUploadResult && (
                        <li className="flex items-center gap-2">
                          <img src="/ens-logo.png" alt="ENS" className="w-4 h-4 rounded-sm object-contain shrink-0" />
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
