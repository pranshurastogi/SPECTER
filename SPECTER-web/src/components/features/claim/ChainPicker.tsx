/**
 * Step 1 of the claim flow: pick which chain to claim from. Only chains
 * that actually hold funds are offered; Sui appears (when funded) as a
 * disabled "Coming soon" row since v1 sweeps are EVM-native only.
 */
import { motion } from "framer-motion";
import { formatUnits } from "viem";
import { ChevronRight } from "lucide-react";
import {
  ArbitrumIcon,
  EthereumIcon,
  MonadIcon,
  SuiIcon,
} from "@/components/ui/specialized/chain-icons";
import { formatCryptoAmount } from "@/lib/utils";
import {
  getChainDecimals,
  getSendChainConfig,
  type EvmTxChain,
} from "@/lib/blockchain/sendChains";

export interface ClaimableChainSummary {
  chain: EvmTxChain;
  /** Sum of live claimable balances (wei). */
  totalWei: bigint;
  /** Number of funded stealth addresses. */
  count: number;
}

function chainIcon(chain: EvmTxChain | "sui") {
  const cls = "h-4 w-4";
  switch (chain) {
    case "ethereum":
      return <EthereumIcon className={cls} />;
    case "arbitrum":
      return <ArbitrumIcon className={cls} />;
    case "monad":
      return <MonadIcon className={cls} />;
    case "sui":
      return <SuiIcon className={cls} />;
  }
}

interface ChainPickerProps {
  chains: ClaimableChainSummary[];
  /** True when funded Sui discoveries exist (shown as Coming soon). */
  suiFunded: boolean;
  onSelect: (chain: EvmTxChain) => void;
}

export function ChainPicker({ chains, suiFunded, onSelect }: ChainPickerProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Choose which chain to claim from. Each address transfers its full
        balance minus network fees.
      </p>
      {chains.map((c, i) => {
        const cfg = getSendChainConfig(c.chain);
        const total = formatUnits(c.totalWei, getChainDecimals(c.chain));
        return (
          <motion.button
            key={c.chain}
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            whileHover={{ x: 3 }}
            onClick={() => onSelect(c.chain)}
            className="w-full p-3 rounded-lg bg-black/35 border border-white/[0.08] flex items-center gap-3 cursor-pointer hover:bg-white/[0.04] hover:border-primary/30 transition-colors text-left"
          >
            <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.1] flex items-center justify-center shrink-0">
              {chainIcon(c.chain)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{cfg.label}</p>
              <p className="text-xs text-muted-foreground">
                {formatCryptoAmount(total)} {cfg.currencySymbol} across {c.count}{" "}
                address{c.count !== 1 ? "es" : ""}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-white/30 shrink-0" />
          </motion.button>
        );
      })}
      {suiFunded && (
        <div
          className="w-full p-3 rounded-lg bg-black/20 border border-white/[0.05] flex items-center gap-3 opacity-60 cursor-not-allowed"
          aria-disabled
        >
          <div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0">
            {chainIcon("sui")}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground/70">Sui</p>
            <p className="text-xs text-muted-foreground">
              Claiming on Sui is on the way
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] text-white/50 shrink-0">
            Coming soon
          </span>
        </div>
      )}
    </div>
  );
}
