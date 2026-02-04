import { useState } from "react";
import { motion } from "framer-motion";
import { Upload, Check, AlertCircle, ExternalLink, Info, Copy, Clipboard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { isValidIpfsCid, ipfsToGatewayUrl } from "@/lib/ensUtils";
import type { Address } from "viem";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Alert,
    AlertDescription,
    AlertTitle,
} from "@/components/ui/alert";

interface SetIpfsHashProps {
    ensName: string;
    currentHash?: string | null;
    walletAddress?: Address;
    chainId?: number;
    onSuccess?: () => void;
}

export function SetIpfsHash({
    ensName,
    currentHash,
    walletAddress,
}: SetIpfsHashProps) {
    const [ipfsCid, setIpfsCid] = useState("");
    const [validationError, setValidationError] = useState<string | null>(null);
    const [isValidated, setIsValidated] = useState(false);
    const [copiedField, setCopiedField] = useState<string | null>(null);

    const handleValidate = () => {
        if (!ipfsCid.trim()) {
            setValidationError(null);
            setIsValidated(false);
            return;
        }

        const isValid = isValidIpfsCid(ipfsCid);

        if (!isValid) {
            setValidationError("Invalid IPFS CID format. Must be a valid CIDv0 (Qm...) or CIDv1 (b...)");
            setIsValidated(false);
            toast.error("Invalid IPFS CID format");
        } else {
            setValidationError(null);
            setIsValidated(true);
            toast.success("✓ Valid IPFS CID - Ready to set!");
        }
    };

    const handleCopy = (text: string, field: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(field);
        toast.success(`${field} copied to clipboard`);
        setTimeout(() => setCopiedField(null), 2000);
    };

    const ensAppUrl = `https://app.ens.domains/${ensName}`;
    const ipfsUrl = ipfsCid && isValidated ? ipfsToGatewayUrl(ipfsCid) : null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
        >
            <Card className="glass-card">
                <CardHeader>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                            <Upload className="h-5 w-5 text-accent" />
                        </div>
                        <div>
                            <CardTitle className="text-lg font-display">Set IPFS Content Hash</CardTitle>
                            <CardDescription className="text-xs mt-1">
                                Validate your IPFS CID and get step-by-step instructions
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="space-y-6">
                    {/* Current Hash Display */}
                    {currentHash && (
                        <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-muted-foreground mb-2">Current IPFS Hash</p>
                                    <code className="text-sm font-mono break-all block mb-3">{currentHash}</code>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        asChild
                                    >
                                        <a
                                            href={ipfsToGatewayUrl(currentHash)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-2"
                                        >
                                            <ExternalLink className="h-3 w-3" />
                                            View on IPFS Gateway
                                        </a>
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* CID Input and Validation */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="ipfs-cid" className="text-sm font-medium">New IPFS CID to Set</Label>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                                            <Info className="h-3 w-3" />
                                            What's a CID?
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="max-w-xs">
                                        <p className="text-sm">
                                            IPFS Content Identifier (CID) is a unique cryptographic hash that points to your content
                                            on IPFS. Example: <code className="text-xs">QmY7Yh4UquoXHLPFo2XbhXkhBvFoPwmQUSa92pxnxjQuPU</code>
                                        </p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>

                        <div className="flex gap-2">
                            <Input
                                id="ipfs-cid"
                                placeholder="e.g., QmY7Yh4UquoXHLPFo2XbhXkhBvFoPwmQUSa92pxnxjQuPU"
                                value={ipfsCid}
                                onChange={(e) => {
                                    setIpfsCid(e.target.value);
                                    setValidationError(null);
                                    setIsValidated(false);
                                }}
                                onBlur={handleValidate}
                                className={`font-mono text-sm ${validationError ? "border-destructive" : isValidated ? "border-success" : ""
                                    }`}
                            />
                            <Button
                                variant={isValidated ? "default" : "outline"}
                                onClick={handleValidate}
                                disabled={!ipfsCid.trim()}
                            >
                                {isValidated ? (
                                    <>
                                        <Check className="h-4 w-4 mr-2 text-success" />
                                        Valid
                                    </>
                                ) : (
                                    "Validate"
                                )}
                            </Button>
                        </div>

                        {validationError && (
                            <div className="flex items-start gap-2 text-sm text-destructive">
                                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                                <span>{validationError}</span>
                            </div>
                        )}

                        {isValidated && (
                            <div className="flex items-start gap-2 p-3 rounded-lg bg-success/10 border border-success/20">
                                <Check className="h-4 w-4 text-success shrink-0 mt-0.5" />
                                <div className="flex-1 text-sm text-success">
                                    <strong>Valid IPFS CID!</strong> Follow the steps below to set it on your ENS name.
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Preview IPFS Content */}
                    {isValidated && ipfsUrl && (
                        <div className="p-4 rounded-lg border border-border/50 bg-gradient-to-br from-accent/5 to-primary/5">
                            <div className="flex items-center justify-between mb-2">
                                <p className="text-sm font-medium">Preview IPFS Content</p>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    asChild
                                >
                                    <a
                                        href={ipfsUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1"
                                    >
                                        <ExternalLink className="h-3 w-3" />
                                        Open
                                    </a>
                                </Button>
                            </div>
                            <code className="text-xs text-muted-foreground break-all">{ipfsUrl}</code>
                        </div>
                    )}

                    {/* Manual Setup Instructions */}
                    {isValidated && (
                        <Alert className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
                            <Clipboard className="h-4 w-4" />
                            <AlertTitle className="text-base font-display font-semibold mb-3">
                                How to Set This IPFS Hash on Your ENS
                            </AlertTitle>
                            <AlertDescription className="space-y-4">
                                <div className="space-y-3">
                                    <div className="flex items-start gap-3">
                                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                                            <span className="text-xs font-bold text-primary">1</span>
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm font-medium mb-2">Visit the ENS Manager App</p>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                asChild
                                                className="mb-2"
                                            >
                                                <a
                                                    href={ensAppUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-2"
                                                >
                                                    <ExternalLink className="h-3 w-3" />
                                                    Open {ensName} on ENS App
                                                </a>
                                            </Button>
                                            <p className="text-xs text-muted-foreground">
                                                This will open the official ENS Manager for your name
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-start gap-3">
                                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                                            <span className="text-xs font-bold text-primary">2</span>
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm font-medium mb-2">Connect Your Wallet</p>
                                            <p className="text-xs text-muted-foreground">
                                                Make sure you're connected with: <code className="text-xs bg-muted px-1 py-0.5 rounded">{walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : 'your wallet'}</code>
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-start gap-3">
                                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                                            <span className="text-xs font-bold text-primary">3</span>
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm font-medium mb-2">Navigate to Records → Content Hash</p>
                                            <p className="text-xs text-muted-foreground mb-2">
                                                Look for the "Records" tab, then find "Content Hash" or "Website/Content" section
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-start gap-3">
                                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                                            <span className="text-xs font-bold text-primary">4</span>
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm font-medium mb-2">Paste Your IPFS CID</p>
                                            <div className="flex items-center gap-2 p-2 rounded bg-muted/50 font-mono text-xs mb-2">
                                                <code className="flex-1 break-all">{ipfsCid}</code>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 w-6 p-0 shrink-0"
                                                    onClick={() => handleCopy(ipfsCid, "IPFS CID")}
                                                >
                                                    {copiedField === "IPFS CID" ? (
                                                        <Check className="h-3 w-3 text-success" />
                                                    ) : (
                                                        <Copy className="h-3 w-3" />
                                                    )}
                                                </Button>
                                            </div>
                                            <p className="text-xs text-muted-foreground">
                                                The ENS app will automatically detect it as an IPFS hash
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-start gap-3">
                                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                                            <span className="text-xs font-bold text-primary">5</span>
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm font-medium mb-2">Confirm the Transaction</p>
                                            <p className="text-xs text-muted-foreground">
                                                Sign the transaction in your wallet. You'll need ETH for gas fees (usually $5-20 depending on network congestion)
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-start gap-3">
                                        <div className="w-6 h-6 rounded-full bg-success/20 flex items-center justify-center shrink-0 mt-0.5">
                                            <Check className="h-3 w-3 text-success" />
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm font-medium mb-1">Done!</p>
                                            <p className="text-xs text-muted-foreground">
                                                Your ENS content hash will be updated on-chain. Content will be accessible at:
                                            </p>
                                            <code className="text-xs text-muted-foreground break-all block mt-1">
                                                https://{ensName}.limo
                                            </code>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-3 border-t border-border/30">
                                    <p className="text-xs text-muted-foreground">
                                        <strong>Alternative tools:</strong> You can also use{" "}
                                        <a
                                            href="https://etherscan.io"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline"
                                        >
                                            Etherscan
                                        </a>
                                        {" "}to interact directly with the ENS resolver contract, or third-party ENS managers like{" "}
                                        <a
                                            href="https://namespace.tech"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline"
                                        >
                                            Namespace
                                        </a>.
                                    </p>
                                </div>
                            </AlertDescription>
                        </Alert>
                    )}

                    {/* Info Section */}
                    <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                        <div className="flex items-start gap-2">
                            <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                            <div className="text-xs text-muted-foreground">
                                <strong className="text-foreground">Why manual setup?</strong> Setting ENS records requires
                                blockchain transactions which need wallet signature and gas fees. SPECTER validates your IPFS CID
                                and provides exact instructions so you can complete the setup through the official ENS app.
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    );
}
