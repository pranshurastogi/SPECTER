import { motion } from "framer-motion";
import { UserPlus, Send, Eye, Download } from "lucide-react";

const steps = [
  { icon: UserPlus, step: "01", title: "Register", desc: "Register ENS with SPECTER" },
  { icon: Send, step: "02", title: "Send", desc: "Send to ENS privately" },
  { icon: Eye, step: "03", title: "On-chain", desc: "Random stealth address" },
  { icon: Download, step: "04", title: "Claim", desc: "Scan and claim funds" },
];

export function HowItWorksSection() {
  return (
    <section className="py-16 md:py-20 px-4">
      <div className="container mx-auto max-w-3xl">
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="font-display text-xl font-semibold text-muted-foreground text-center mb-10"
        >
          How it works
        </motion.h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {steps.map((s, i) => (
            <motion.div
              key={s.step}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06 }}
              className="glass-panel p-5 rounded-xl text-center"
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-3">
                <s.icon className="h-4 w-4 text-primary" />
              </div>
              <span className="text-xs font-display text-primary">{s.step}</span>
              <h3 className="font-display font-semibold text-sm mt-1">{s.title}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
