import { motion, animate } from "framer-motion";
import { useEffect, useState } from "react";
import {
  Shield,
  Zap,
  Tag,
  UserPlus,
  Send,
  Eye,
  Download,
  CheckCircle2,
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
    "text-muted-foreground text-lg md:text-xl lg:text-2xl font-normal text-left max-w-2xl mb-8";
  const featureTitle = "font-display font-semibold text-xl md:text-2xl mb-1.5 text-foreground";
  const featureDesc = "text-muted-foreground text-base md:text-lg text-left";
  const stepTitle = "font-display font-semibold text-lg md:text-xl text-foreground";
  const stepDesc = "text-base text-muted-foreground text-left";

  const data: TimelineEntry[] = [
    {
      title: "Built for the future",
      content: (
        <div className="max-w-4xl">
          <p className={sectionIntro}>
            SPECTER combines cutting-edge cryptography with intuitive design.
          </p>
          <div className="grid gap-8 md:grid-cols-3 md:gap-10">
            <div className="py-4 pr-4">
              <Shield className="h-9 w-9 text-primary mb-3" />
              <h4 className={featureTitle}>Quantum-Proof</h4>
              <p className={featureDesc}>
                ML-KEM-768 post-quantum cryptography
              </p>
            </div>
            <div className="py-4 pr-4">
              <Zap className="h-9 w-9 text-primary mb-3" />
              <h4 className={featureTitle}>66% Faster</h4>
              <p className={featureDesc}>
                View tag optimization for fast scanning
              </p>
            </div>
            <div className="py-4 pr-4">
              <Tag className="h-9 w-9 text-primary mb-3" />
              <h4 className={featureTitle}>ENS Native</h4>
              <p className={featureDesc}>
                Human-readable private payments
              </p>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "How it works",
      content: (
        <div className="max-w-4xl">
          <p className={sectionIntro}>
            Four simple steps to complete privacy.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
            {[
              { icon: UserPlus, step: "01", title: "Register", desc: "Register ENS with SPECTER meta-address" },
              { icon: Send, step: "02", title: "Send", desc: "Send to ENS privately" },
              { icon: Eye, step: "03", title: "On-chain", desc: "Payment to random stealth address" },
              { icon: Download, step: "04", title: "Claim", desc: "Scan and claim funds" },
            ].map((s) => (
              <div
                key={s.step}
                className="py-4 text-left"
              >
                <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
                  <s.icon className="h-6 w-6 text-primary" />
                </div>
                <span className="text-base font-display text-primary block mb-0.5">{s.step}</span>
                <h4 className={stepTitle}>{s.title}</h4>
                <p className={`${stepDesc} mt-0.5`}>{s.desc}</p>
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
          <div className="grid grid-cols-3 gap-6 md:gap-8 py-4 text-center">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <div className="font-display text-4xl md:text-6xl lg:text-7xl font-bold">
                  <AnimatedNumber value={s.value} suffix={s.suffix} />
                </div>
                <div className="text-base md:text-lg text-muted-foreground mt-1.5">
                  {s.label}
                </div>
              </motion.div>
            ))}
          </div>
          <div className="space-y-2.5 pt-6 border-t border-border/50">
            <div className="flex gap-3 items-center text-muted-foreground text-base md:text-lg lg:text-xl text-left">
              <CheckCircle2 className="h-6 w-6 text-primary shrink-0" />
              Quantum-safe ML-KEM-768
            </div>
            <div className="flex gap-3 items-center text-muted-foreground text-base md:text-lg lg:text-xl text-left">
              <CheckCircle2 className="h-6 w-6 text-primary shrink-0" />
              ENS-native private payments
            </div>
            <div className="flex gap-3 items-center text-muted-foreground text-base md:text-lg lg:text-xl text-left">
              <CheckCircle2 className="h-6 w-6 text-primary shrink-0" />
              Stealth addresses on-chain
            </div>
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
        subtitle="Post-quantum privacy for ENS payments. Built for the future."
      />
    </section>
  );
}
