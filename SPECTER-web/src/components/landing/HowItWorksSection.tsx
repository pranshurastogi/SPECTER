import { motion } from "framer-motion";
import { UserPlus, Send, Eye, Download } from "lucide-react";

const steps = [
  {
    icon: UserPlus,
    step: "01",
    title: "Register",
    description: "Register bob.eth with SPECTER meta-address",
  },
  {
    icon: Send,
    step: "02",
    title: "Send",
    description: "Alice sends to bob.eth privately",
  },
  {
    icon: Eye,
    step: "03",
    title: "On-chain",
    description: "Payment goes to a random stealth address",
  },
  {
    icon: Download,
    step: "04",
    title: "Claim",
    description: "Bob scans and claims the funds",
  },
];

export function HowItWorksSection() {
  return (
    <section className="py-24 relative">
      <div className="absolute inset-0 grid-pattern opacity-20" />
      
      <div className="container mx-auto px-4 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">
            How it works
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Four simple steps to complete privacy
          </p>
        </motion.div>

        <div className="relative max-w-4xl mx-auto">
          {/* Connection line */}
          <div className="hidden md:block absolute top-20 left-[10%] right-[10%] h-[2px] bg-gradient-to-r from-primary/50 via-accent/50 to-primary/50" />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {steps.map((step, index) => (
              <motion.div
                key={step.step}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="relative text-center"
              >
                {/* Step circle */}
                <div className="relative mx-auto mb-6">
                  <div className="w-16 h-16 rounded-full bg-card border-2 border-primary/30 flex items-center justify-center mx-auto relative z-10">
                    <step.icon className="h-7 w-7 text-primary" />
                  </div>
                  {/* Pulse effect */}
                  <div className="absolute inset-0 rounded-full bg-primary/20 animate-pulse-ring" />
                </div>

                {/* Step number */}
                <div className="text-xs font-display text-primary mb-2">
                  {step.step}
                </div>

                {/* Title */}
                <h3 className="font-display text-lg font-semibold mb-2">
                  {step.title}
                </h3>

                {/* Description */}
                <p className="text-sm text-muted-foreground">
                  {step.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
