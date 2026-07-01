import { motion, useInView } from "framer-motion";
import { useRef, useState, type ComponentType } from "react";
import { TextScramble } from "@/components/ui/animations/text-scramble";
import {
  LockUnlockIcon,
  SendIcon,
  EyeToggleIcon,
  DownloadDoneIcon,
  SuccessIcon,
} from "@/components/ui/animated-state-icons";
import {
  PencilIcon,
  MetronomeIcon,
  CompassIcon,
} from "@/components/ui/animated-everyday-icons";
import { Timeline } from "@/components/ui/specialized/timeline";
import type { TimelineEntry } from "@/components/ui/specialized/timeline";

type AnimatedIcon = ComponentType<{ size?: number; className?: string }>;

function AnimatedNumber({
  value,
  suffix,
}: {
  value: number;
  suffix: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  const [hoverTick, setHoverTick] = useState(0);

  const str =
    suffix === "%"
      ? value.toFixed(1)
      : suffix === "s"
        ? value.toFixed(1)
        : Math.floor(value).toString();
  const display = `${str}${suffix}`;

  // Scramble on scroll-in, and re-scramble every hover.
  const trigger = (isInView ? 1 : 0) + hoverTick;

  return (
    <span
      ref={ref}
      onMouseEnter={() => setHoverTick((t) => t + 1)}
      className="inline-block cursor-default"
    >
      <TextScramble
        as="span"
        trigger={trigger}
        duration={0.9}
        speed={0.03}
        className="font-display font-bold tabular-nums bg-clip-text text-transparent bg-gradient-to-b from-amber-200 via-amber-300 to-amber-500 drop-shadow-[0_0_16px_rgba(245,158,11,0.35)]"
      >
        {display}
      </TextScramble>
    </span>
  );
}

// Shared amber tile — keeps the whole flow on the SPECTER "signal" palette.
const tileClass =
  "inline-flex items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/15 to-amber-600/[0.06] border border-amber-500/25 text-amber-300 shadow-[0_0_22px_rgba(245,158,11,0.12)]";

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

  const steps: {
    Icon: AnimatedIcon;
    step: string;
    title: string;
    desc: string;
  }[] = [
    {
      Icon: LockUnlockIcon,
      step: "01",
      title: "Generate keys",
      desc: "Create your post-quantum SPECTER keys on Setup",
    },
    {
      Icon: PencilIcon,
      step: "02",
      title: "Register",
      desc: "Link your meta-address to an ENS or SuiNS name",
    },
    {
      Icon: SendIcon,
      step: "03",
      title: "Send",
      desc: "Pay any human-readable name — privately",
    },
    {
      Icon: EyeToggleIcon,
      step: "04",
      title: "Onchain",
      desc: "Funds land at a fresh, unlinkable stealth address",
    },
    {
      Icon: DownloadDoneIcon,
      step: "05",
      title: "Claim",
      desc: "Scan with view tags and sweep your funds",
    },
  ];

  const features: {
    Icon: AnimatedIcon;
    title: string;
    desc: string;
  }[] = [
    {
      Icon: SuccessIcon,
      title: "Quantum-Proof",
      desc: "ML-KEM-768 post-quantum cryptography",
    },
    {
      Icon: MetronomeIcon,
      title: "66% Faster",
      desc: "View-tag optimization for lightning scanning",
    },
    {
      Icon: CompassIcon,
      title: "ENS + SuiNS",
      desc: "Human-readable private payments on Ethereum and Sui",
    },
  ];

  const data: TimelineEntry[] = [
    {
      title: "From setup to claim",
      content: (
        <div className="max-w-4xl">
          <p className={sectionIntro}>
            Five simple steps to complete privacy.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-5 md:gap-6">
            {steps.map((s) => (
              <div
                key={s.step}
                className="py-4 flex flex-col items-center md:items-start text-center md:text-left"
              >
                <div className={`mb-3 h-12 w-12 ${tileClass}`}>
                  <s.Icon size={26} />
                </div>
                <span className="text-sm font-mono uppercase tracking-[0.18em] mb-1.5 font-semibold text-amber-400/80">
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
      title: "Built for the future",
      content: (
        <div className="max-w-4xl">
          <p className={sectionIntro}>
            SPECTER combines lattice cryptography with intuitive design.
          </p>
          <div className="grid gap-6 md:grid-cols-3 md:gap-10">
            {features.map((f) => (
              <div
                key={f.title}
                className="py-4 pr-4 flex flex-col items-center md:items-start text-center md:text-left"
              >
                <div className={`mb-4 h-12 w-12 ${tileClass}`}>
                  <f.Icon size={26} />
                </div>
                <h4 className={featureTitle}>{f.title}</h4>
                <p className={featureDesc}>{f.desc}</p>
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
            {[
              { value: 99.6, suffix: "%", label: "Scanning efficiency" },
              { value: 1.5, suffix: "s", label: "Scan time (80k announcements)" },
              { value: 2030, suffix: "", label: "Future-proof (quantum-safe)" },
            ].map((s, i) => (
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
