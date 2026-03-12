import { useRef } from "react";
import { motion, PanInfo } from "framer-motion";

export function YellowEnvToggleButton(props: {
  isSandbox: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const { isSandbox, onToggle, disabled } = props;
  const TRAVEL_DISTANCE = 192; // 240 (width) - 8 (padding) - 40 (knob size)

  const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (disabled) return;
    const offset = info.offset.x;
    
    // Swipe right to Mainnet
    if (isSandbox && offset > TRAVEL_DISTANCE / 3) {
      onToggle();
    } 
    // Swipe left to Sandbox
    else if (!isSandbox && offset < -TRAVEL_DISTANCE / 3) {
      onToggle();
    }
  };

  return (
    <div className="w-fit">
      <div
        className={[
          "relative h-12 w-[240px] rounded-full p-1 overflow-hidden group select-none",
          "transition-all duration-500 ease-out",
          disabled ? "opacity-60 cursor-not-allowed" : "",
          "backdrop-blur-xl border",
          isSandbox
            ? "bg-amber-400/15 border-amber-300/30 shadow-[0_0_40px_rgba(245,158,11,0.12),inset_0_1px_0_rgba(255,255,255,0.15)]"
            : "bg-orange-500/15 border-orange-400/30 shadow-[0_0_40px_rgba(234,88,12,0.15),inset_0_1px_0_rgba(255,255,255,0.15)]",
        ].join(" ")}
      >
        {/* Shimmer layer */}
        <div className="absolute inset-0 overflow-hidden rounded-full pointer-events-none">
          <div
            className={[
              "absolute inset-x-0 -top-px h-[1px]",
              "bg-gradient-to-r from-transparent via-white/30 to-transparent",
            ].join(" ")}
          />
          <motion.div
            className={[
              "absolute w-48 h-48 rounded-full blur-3xl opacity-0 group-hover:opacity-100",
              "transition-opacity duration-700",
              isSandbox ? "bg-amber-400/20" : "bg-orange-500/20",
            ].join(" ")}
            animate={{
              x: isSandbox ? "60%" : "-20%",
              y: "-30%",
            }}
            transition={{ type: "spring", stiffness: 200, damping: 40 }}
          />
        </div>

        {/* Text indicators */}
        <div className="absolute inset-0 flex items-center pointer-events-none z-0">
             <motion.span 
               initial={false}
               animate={{ opacity: isSandbox ? 1 : 0 }}
               className="absolute left-[3.5rem] text-[10px] font-bold tracking-widest text-amber-200/90 flex items-center gap-2"
             >
               SWIPE TO MAINNET <span className="opacity-60 text-[10px]">&rarr;</span>
             </motion.span>
             
             <motion.span 
               initial={false}
               animate={{ opacity: !isSandbox ? 1 : 0 }}
               className="absolute right-[3.5rem] text-[10px] font-bold tracking-widest text-orange-200/90 flex items-center gap-2"
             >
               <span className="opacity-60 text-[10px]">&larr;</span> SWIPE TO SANDBOX
             </motion.span>
        </div>

        {/* Sliding glass indicator (Knob) */}
        <motion.div
          drag={disabled ? false : "x"}
          dragConstraints={{ left: 0, right: TRAVEL_DISTANCE }}
          dragElastic={0.05}
          dragMomentum={false}
          onDragEnd={handleDragEnd}
          animate={{
            x: isSandbox ? 0 : TRAVEL_DISTANCE,
          }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className={[
            "absolute top-1 left-1 h-10 w-10 rounded-full flex gap-1 items-center justify-center cursor-grab active:cursor-grabbing z-10",
            "backdrop-blur-md border transition-colors duration-500",
            isSandbox
              ? "bg-amber-400/40 border-amber-300/50 shadow-[0_0_20px_rgba(245,158,11,0.3)]"
              : "bg-orange-500/40 border-orange-400/50 shadow-[0_0_20px_rgba(234,88,12,0.3)]",
          ].join(" ")}
        >
          {/* Grip lines */}
          <div className="w-[2px] h-3.5 rounded-full bg-white/70" />
          <div className="w-[2px] h-3.5 rounded-full bg-white/70" />
        </motion.div>
      </div>
    </div>
  );
}
