import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect, useState } from "react";

const stats = [
  {
    value: 99.6,
    suffix: "%",
    label: "Scanning Efficiency",
    description: "View tag filtering",
  },
  {
    value: 1.5,
    suffix: "s",
    label: "Scan Time",
    description: "For 80k announcements",
  },
  {
    value: 2030,
    suffix: "",
    label: "Future-Proof",
    description: "Quantum-safe cryptography",
  },
];

function AnimatedNumber({ value, suffix }: { value: number; suffix: string }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const controls = animate(0, value, {
      duration: 2,
      ease: "easeOut",
      onUpdate: (latest) => {
        setDisplayValue(latest);
      },
    });

    return () => controls.stop();
  }, [value]);

  const formatValue = () => {
    if (suffix === "%") {
      return displayValue.toFixed(1);
    } else if (suffix === "s") {
      return displayValue.toFixed(1);
    }
    return Math.floor(displayValue).toString();
  };

  return (
    <span className="gradient-text">
      {formatValue()}
      {suffix}
    </span>
  );
}

export function StatsSection() {
  return (
    <section className="py-24 relative">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="glass-card p-12"
        >
          <div className="grid md:grid-cols-3 gap-12">
            {stats.map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.15 }}
                className="text-center"
              >
                <div className="font-display text-4xl md:text-5xl font-bold mb-2">
                  <AnimatedNumber value={stat.value} suffix={stat.suffix} />
                </div>
                <div className="font-display text-lg font-semibold mb-1">
                  {stat.label}
                </div>
                <div className="text-sm text-muted-foreground">
                  {stat.description}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
