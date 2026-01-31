import { motion } from "framer-motion";
import { Zap, Tag } from "lucide-react";

function LogoIcon(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  return <img src="/SPECTER-logo.png" alt="SPECTER" {...props} />;
}

const features = [
  {
    icon: LogoIcon,
    title: "Quantum-Proof",
    description: "Uses ML-KEM-768 (NIST-standardized) post-quantum cryptography",
    color: "primary",
  },
  {
    icon: Zap,
    title: "66% Faster",
    description: "View tag optimization enables lightning-fast scanning",
    color: "accent",
  },
  {
    icon: Tag,
    title: "ENS Native",
    description: "Human-readable private payments with your ENS name",
    color: "success",
  },
];

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
    },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

export function FeaturesSection() {
  return (
    <section className="py-24 relative">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">
            Built for the future
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            SPECTER combines cutting-edge cryptography with intuitive design
          </p>
        </motion.div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="grid md:grid-cols-3 gap-6"
        >
          {features.map((feature) => (
            <motion.div
              key={feature.title}
              variants={item}
              className="group"
            >
              <div className="glass-card p-8 h-full transition-all duration-300 hover:border-primary/40">
                <div
                  className={`w-14 h-14 rounded-xl bg-${feature.color}/10 border border-${feature.color}/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300`}
                >
                  <feature.icon className={`h-7 w-7 text-${feature.color}`} />
                </div>
                <h3 className="font-display text-xl font-semibold mb-3">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
