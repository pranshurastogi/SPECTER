import { motion, animate, useInView } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  ShieldCheck,
  Gauge,
  Network,
  KeyRound,
  UserPlus,
  Send,
  Eye,
  WalletCards,
} from "lucide-react";
import { Timeline } from "@/components/ui/specialized/timeline";
import type { TimelineEntry } from "@/components/ui/specialized/timeline";

const stats = [
  { value: 99.6, suffix: "%", label: "Scanning efficiency" },
  { value: 1.5, suffix: "s", label: "Scan time (80k announcements)" },
  { value: 2030, suffix: "", label: "Future-proof (quantum-safe)" },
];

function AnimatedNumber({
  value,
  suffix,
}: {
  value: number;
  suffix: string;
}) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });

  useEffect(() => {
    if (!isInView) return;
    const c = animate(0, value, {
      duration: 2,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setN(v),
    });
    return () => c.stop();
  }, [value, isInView]);

  const str =
    suffix === "%"
      ? n.toFixed(1)
      : suffix === "s"
        ? n.toFixed(1)
        : Math.floor(n).toString();

  return (
    <span ref={ref} className="gradient-text font-display font-bold tabular-nums">
      {str}
      {suffix}
    </span>
  );
}

export function TimelineSection() {

  const sectionIntro =
    "text-muted-foreground text-lg md:text-xl lg:text-2xl font-normal text-center md:text-left max-w-3xl mb-10 md:mb-8 mx-auto md:mx-0";
  const featureTitle =
    "font-display font-semibold text-lg md:text-xl mb-1.5 text-foreground tracking-tight";
  const featureDesc =
    "text-muted-foreground text-sm md:text-base lg:text-lg text-center md:text-left leading-relaxed";
  const stepTitle =
    "font-display font-semibold text-base md:text-lg lg:text-xl text-foreground tracking-tight";
  const stepDesc =
    "text-sm md:text-base text-muted-foreground text-center md:text-left leading-relaxed";

  const data: TimelineEntry[] = [
    {
      title: "Built for the future",
      content: (
        <div className="max-w-4xl">
          <p className={sectionIntro}>
            SPECTER combines lattice cryptography with intuitive design.
          </p>
          <div className="grid gap-6 md:grid-cols-3 md:gap-10">
            <div className="py-4 pr-4 flex flex-col items-center md:items-start text-center md:text-left">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-500/10 border border-purple-500/20 shadow-[0_0_20px_rgba(168,85,247,0.15)]">
                <ShieldCheck className="h-6 w-6 text-purple-400" />
              </div>
              <h4 className={featureTitle}>Quantum-Proof</h4>
              <p className={featureDesc}>
                ML-KEM-768 post-quantum cryptography
              </p>
            </div>
            <div className="py-4 pr-4 flex flex-col items-center md:items-start text-center md:text-left">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 border border-cyan-500/20 shadow-[0_0_20px_rgba(34,211,238,0.15)]">
                <Gauge className="h-6 w-6 text-cyan-400" />
              </div>
              <h4 className={featureTitle}>66% Faster</h4>
              <p className={featureDesc}>
                View tag optimization for fast scanning
              </p>
            </div>
            <div className="py-4 pr-4 flex flex-col items-center md:items-start text-center md:text-left">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 shadow-[0_0_20px_rgba(52,211,153,0.15)]">
                <Network className="h-6 w-6 text-emerald-400" />
              </div>
              <h4 className={featureTitle}>ENS + SuiNS</h4>
              <p className={featureDesc}>
                Human-readable private payments on Ethereum and Sui
              </p>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "From setup to claim",
      content: (
        <div className="max-w-4xl">
          <p className={sectionIntro}>
            Five simple steps to complete privacy.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-5 md:gap-6">
            {[
              {
                icon: KeyRound,
                step: "01",
                title: "Generate keys",
                desc: "Create your SPECTER keys on Setup",
                color: "text-purple-400",
                bg: "bg-purple-500/10",
                border: "border-purple-500/20",
              },
              {
                icon: UserPlus,
                step: "02",
                title: "Register",
                desc: "Link meta-address to ENS or SuiNS",
                color: "text-blue-400",
                bg: "bg-blue-500/10",
                border: "border-blue-500/20",
              },
              {
                icon: Send,
                step: "03",
                title: "Send",
                desc: "Send to any name privately",
                color: "text-cyan-400",
                bg: "bg-cyan-500/10",
                border: "border-cyan-500/20",
              },
              {
                icon: Eye,
                step: "04",
                title: "Onchain",
                desc: "Payment to random stealth address",
                color: "text-emerald-400",
                bg: "bg-emerald-500/10",
                border: "border-emerald-500/20",
              },
              {
                icon: WalletCards,
                step: "05",
                title: "Claim",
                desc: "Scan and claim funds",
                color: "text-amber-400",
                bg: "bg-amber-500/10",
                border: "border-amber-500/20",
              },
            ].map((s) => (
              <div
                key={s.step}
                className="py-4 flex flex-col items-center md:items-start text-center md:text-left"
              >
                <div className={`mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl ${s.bg} border ${s.border}`}>
                  <s.icon className={`h-6 w-6 ${s.color}`} />
                </div>
                <span className="gradient-text text-sm font-mono uppercase tracking-[0.18em] mb-1.5 font-semibold">
                  {s.step}
                </span>
                <h4 className={stepTitle}>{s.title}</h4>
                <p className={`${stepDesc} mt-1`}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      title: "By the numbers",
      content: (
        <div className="max-w-4xl">
          <p className={sectionIntro}>
            View tag filtering and quantum-safe cryptography.
          </p>
          <div className="grid grid-cols-3 gap-4 md:gap-8 py-4 text-center">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="flex flex-col items-center"
              >
                <div className="font-display text-3xl md:text-4xl lg:text-5xl font-bold">
                  <AnimatedNumber value={s.value} suffix={s.suffix} />
                </div>
                <div className="text-xs md:text-sm text-muted-foreground mt-2 uppercase tracking-[0.18em]">
                  {s.label}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      ),
    },
  ];

  return (
    <section className="relative py-4 md:py-6">
      <Timeline
        data={data}
        title="How SPECTER works"
        subtitle="Send privately. Stay private. Even Post Quantum."
      />
    </section>
  );
}
