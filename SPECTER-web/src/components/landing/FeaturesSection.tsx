import { motion } from "framer-motion";
import { Zap, Tag, Shield } from "lucide-react";

const features = [
  {
    icon: Shield,
    title: "Quantum-Proof",
    description: "ML-KEM-768 post-quantum cryptography",
  },
  {
    icon: Zap,
    title: "66% Faster",
    description: "View tag optimization for fast scanning",
  },
  {
    icon: Tag,
    title: "ENS Native",
    description: "Human-readable private payments",
  },
];

export function FeaturesSection() {
  return (
    <section className="py-16 md:py-20 px-4">
      <div className="container mx-auto max-w-4xl">
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="font-display text-xl font-semibold text-muted-foreground text-center mb-10"
        >
          Built for the future
        </motion.h2>

        <div className="grid md:grid-cols-3 gap-4 md:gap-6">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="glass-panel p-6 rounded-xl"
            >
              <feature.icon className="h-5 w-5 text-primary mb-3" />
              <h3 className="font-display font-semibold mb-1.5">
                {feature.title}
              </h3>
              <p className="text-sm text-muted-foreground">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
