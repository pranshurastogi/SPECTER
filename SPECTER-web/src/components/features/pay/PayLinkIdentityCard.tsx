import { ShieldCheck, Lock, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/base/card";
import { Badge } from "@/components/ui/base/badge";
import { Skeleton } from "@/components/ui/base/skeleton";
import { getSendChainConfig, type TxChain } from "@/lib/blockchain/sendChains";

export type PayResolveStatus = "resolving" | "resolved" | "error";

export function PayLinkIdentityCard({
  recipient,
  status,
  amount,
  chain,
  label,
  memo,
  errorMessage,
}: {
  recipient: string;
  status: PayResolveStatus;
  amount?: string;
  chain?: TxChain;
  label?: string;
  memo?: string;
  errorMessage?: string;
}) {
  const symbol = chain ? getSendChainConfig(chain).currencySymbol : "";

  return (
    <Card className="w-full max-w-md mx-auto mb-6 overflow-hidden">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-full bg-primary/15 flex items-center justify-center text-primary font-semibold">
            {recipient.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">You're paying</p>
            {status === "resolving" ? (
              <Skeleton className="h-5 w-32 mt-1" />
            ) : (
              <p className="font-semibold truncate">{recipient}</p>
            )}
          </div>
        </div>

        {status === "error" ? (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{errorMessage ?? `${recipient} isn't on SPECTER yet.`}</span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="gap-1">
                <ShieldCheck className="h-3 w-3" /> Stealth address
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <Lock className="h-3 w-3" /> Post-quantum
              </Badge>
            </div>

            {amount && (
              <p className="text-2xl font-bold">
                {amount}{" "}
                <span className="text-base font-medium text-muted-foreground">
                  {symbol}
                </span>
              </p>
            )}
            {label && <p className="text-sm font-medium">{label}</p>}
            {memo && <p className="text-sm text-muted-foreground">{memo}</p>}

            <p className="text-xs text-muted-foreground leading-relaxed border-t border-border pt-3">
              A unique private address is generated just for you. {recipient} can
              find this payment; no one else can link it to them.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
