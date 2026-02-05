import { motion, animate } from "framer-motion";
import { useEffect, useState } from "react";

const stats = [
  { value: 99.6, suffix: "%", label: "Efficiency" },
  { value: 1.5, suffix: "s", label: "Scan time" },
  { value: 2030, suffix: "", label: "Future-proof" },
];

function AnimatedNumber({ value, suffix }: { value: number; suffix: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const c = animate(0, value, {
      duration: 1.8,
      ease: "easeOut",
      onUpdate: (v) => setN(v),
    });
    return () => c.stop();
  }, [value]);
  const str = suffix === "%" ? n.toFixed(1) : suffix === "s" ? n.toFixed(1) : Math.floor(n).toString();
  return <span className="gradient-text">{str}{suffix}</span>;
}

export function StatsSection() {
  return (
    <section className="py-16 md:py-20 px-4">
      <div className="container mx-auto max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="glass-panel p-8 rounded-2xl"
        >
          <div className="grid grid-cols-3 gap-8 text-center">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <div className="font-display text-2xl md:text-3xl font-bold">
                  <AnimatedNumber value={s.value} suffix={s.suffix} />
                </div>
                <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
