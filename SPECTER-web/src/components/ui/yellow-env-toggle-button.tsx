import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { ArrowUpRight, Droplets, Flame } from "lucide-react";

export function YellowEnvToggleButton(props: {
  isSandbox: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const { isSandbox, onToggle, disabled } = props;
  const next = isSandbox ? "Mainnet" : "Sandbox";
  const current = isSandbox ? "Sandbox" : "Mainnet";

  return (
    <motion.div
      whileHover={disabled ? undefined : { scale: 1.015 }}
      whileTap={disabled ? undefined : { scale: 0.985 }}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
      className="w-fit"
    >
      <Button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={[
          "relative h-12 w-[232px] rounded-full p-1 overflow-hidden group",
          "transition-all duration-300",
          "ring-1 ring-white/10",
          "shadow-[0_14px_50px_rgba(0,0,0,0.55)]",
          "disabled:opacity-60 disabled:cursor-not-allowed",
          isSandbox
            ? "bg-gradient-to-r from-amber-400/95 via-orange-400/85 to-amber-500/95 text-black"
            : "bg-gradient-to-r from-orange-400/95 via-amber-300/80 to-orange-500/95 text-black",
        ].join(" ")}
      >
        {/* subtle sheen */}
        <div className="absolute inset-0 opacity-40">
          <div className="absolute -inset-x-28 -top-10 h-24 bg-white/18 blur-2xl rotate-12 translate-y-0 group-hover:translate-y-2 transition-transform duration-500" />
        </div>

        {/* current mode (left) */}
        <div className="relative z-10 h-full w-full flex items-center justify-between px-4 select-none">
          <div className="flex items-center gap-2">
            {isSandbox ? (
              <Droplets className="w-4 h-4 text-black/80" />
            ) : (
              <Flame className="w-4 h-4 text-black/80" />
            )}
            <div className="flex flex-col justify-center leading-none">
              <div className="text-[11px] uppercase tracking-wide text-black/70 leading-none">
                Mode
              </div>
              <div className="mt-0.5 text-sm font-semibold text-black leading-none">
                {current}
              </div>
            </div>
          </div>

          <div className="text-[11px] text-black/70 leading-none text-right">
            Switch to <span className="font-semibold text-black/85">{next}</span>
          </div>
        </div>

        {/* moving action bubble */}
        <motion.div
          aria-hidden
          className="absolute top-1 h-10 w-10 rounded-full bg-black/90 text-white flex items-center justify-center shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
          animate={{ left: isSandbox ? "calc(100% - 44px)" : "4px", rotate: isSandbox ? 0 : 45 }}
          transition={{ type: "spring", stiffness: 520, damping: 36 }}
        >
          <ArrowUpRight size={16} />
        </motion.div>

        {/* next label (inside bubble hint) */}
        <div className="sr-only">Switch to {next}</div>
      </Button>
    </motion.div>
  );
}

