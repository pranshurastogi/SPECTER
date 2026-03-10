import { motion, animate } from "framer-motion";
import { useEffect, useState } from "react";
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
import { Timeline } from "@/components/ui/timeline";
import type { TimelineEntry } from "@/components/ui/timeline";

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
  useEffect(() => {
    const c = animate(0, value, {
      duration: 1.8,
      ease: "easeOut",
      onUpdate: (v) => setN(v),
    });
    return () => c.stop();
  }, [value]);
  const str =
    suffix === "%"
      ? n.toFixed(1)
      : suffix === "s"
        ? n.toFixed(1)
        : Math.floor(n).toString();
  return (
    <span className="gradient-text font-display font-bold">
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
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 border border-primary/30 shadow-[0_0_24px_rgba(129,140,248,0.3)]">
                <ShieldCheck className="h-6 w-6 text-primary" />
              </div>
              <h4 className={featureTitle}>Quantum-Proof</h4>
              <p className={featureDesc}>
                ML-KEM-768 post-quantum cryptography
              </p>
            </div>
            <div className="py-4 pr-4 flex flex-col items-center md:items-start text-center md:text-left">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 border border-accent/40 shadow-[0_0_24px_rgba(45,212,191,0.25)]">
                <Gauge className="h-6 w-6 text-accent" />
              </div>
              <h4 className={featureTitle}>66% Faster</h4>
              <p className={featureDesc}>
                View tag optimization for fast scanning
              </p>
            </div>
            <div className="py-4 pr-4 flex flex-col items-center md:items-start text-center md:text-left">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 border border-primary/30 shadow-[0_0_24px_rgba(129,140,248,0.3)]">
                <Network className="h-6 w-6 text-primary" />
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
              },
              { icon: UserPlus, step: "02", title: "Register", desc: "Link meta-address to ENS or SuiNS" },
              { icon: Send, step: "03", title: "Send", desc: "Send to any name privately" },
              { icon: Eye, step: "04", title: "Onchain", desc: "Payment to random stealth address" },
              { icon: WalletCards, step: "05", title: "Claim", desc: "Scan and claim funds" },
            ].map((s) => (
              <div
                key={s.step}
                className="py-4 flex flex-col items-center md:items-start text-center md:text-left"
              >
                <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary/40 border border-border/60 shadow-[0_0_18px_rgba(15,23,42,0.75)]">
                  <s.icon className="h-6 w-6 text-primary" />
                </div>
                <span className="text-xs md:text-sm font-mono uppercase tracking-[0.18em] text-muted-foreground mb-1.5">
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
                <div className="font-display text-4xl md:text-6xl lg:text-7xl font-bold">
                  <AnimatedNumber value={s.value} suffix={s.suffix} />
                </div>
                <div className="text-xs md:text-sm lg:text-base text-muted-foreground mt-2 uppercase tracking-[0.18em]">
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
