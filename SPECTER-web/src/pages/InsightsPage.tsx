import { BookOpen, ExternalLink } from "lucide-react";
import { HomeLayout } from "@/components/layout/HomeLayout";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MediumBlogCard } from "@/components/features/insights/MediumBlogCard";
import { TwitterThreadCard } from "@/components/features/insights/TwitterThreadCard";
import { MEDIUM_POSTS, TWITTER_THREADS } from "@/components/features/insights/insightsData";
import { XLogo } from "@/components/features/insights/XLogo";
import { ParticleCanvas } from "@/components/features/insights/ParticleCanvas";

import "react-tweet/theme.css";

function SectionDivider({ icon, title, subtitle, action }: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col gap-2 mb-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-amber-500/10 ring-1 ring-amber-500/20 text-amber-400">
            {icon}
          </div>
          <h2 className="text-2xl font-bold text-zinc-100 tracking-tight">{title}</h2>
        </div>
        {action && (
          <a
            href={action.href}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors"
          >
            {action.label}
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
      <p className="text-sm text-zinc-500 pl-0 sm:pl-12 max-w-lg">{subtitle}</p>
      <div className="h-px bg-gradient-to-r from-amber-500/40 via-amber-400/10 to-transparent mt-2" />
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/50 p-12 text-center">
      <p className="text-zinc-600 text-sm">Nothing here yet. Come back soon.</p>
    </div>
  );
}

export default function InsightsPage() {
  return (
    <HomeLayout>
      <Header />

      <main className="pt-24 sm:pt-28 pb-16 sm:pb-20 px-4 sm:px-6">

        {/* Hero */}
        <section className="max-w-3xl mx-auto mb-16 sm:mb-24 text-center relative rounded-3xl overflow-hidden bg-zinc-950 border border-amber-500/10">
          {/* Particle rain — fills the hero container */}
          <ParticleCanvas />

          {/* Bat signal glow */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 mx-auto w-72 sm:w-96 h-72 sm:h-96 rounded-full opacity-15 blur-3xl"
            style={{ background: "radial-gradient(circle, #f59e0b 0%, transparent 70%)" }}
          />

          <div className="relative z-10 py-14 sm:py-20 px-6">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20 px-3 py-1.5 text-xs font-semibold mb-5 uppercase tracking-widest">
              Writings
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight mb-4 sm:mb-5">
              <span className="text-zinc-100">Things I think about</span>
              <br />
              <span
                style={{
                  background: "linear-gradient(135deg, #f59e0b 0%, #fcd34d 50%, #f59e0b 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                post-quantum and privacy
              </span>
            </h1>

            <p className="text-zinc-400 text-sm sm:text-base lg:text-lg leading-relaxed max-w-xl mx-auto px-2">
              Deep dives on Medium. Quick takes on X.
            </p>
          </div>
        </section>

        <div className="max-w-5xl mx-auto space-y-16 sm:space-y-24">

          {/* Articles */}
          <section id="articles">
            <SectionDivider
              icon={<BookOpen className="w-4 h-4" />}
              title="Articles"
              subtitle="Longer pieces where I actually have room to go deep on a topic."
              action={{
                label: "All posts on Medium",
                href: "https://medium.com/@pranshurastogi",
              }}
            />
            {MEDIUM_POSTS.length === 0 ? (
              <EmptyState label="articles" />
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-8">
                {MEDIUM_POSTS.map((post) => (
                  <MediumBlogCard key={post.id} post={post} />
                ))}
              </div>
            )}
          </section>

          {/* X Threads */}
          <section id="threads">
            <SectionDivider
              icon={<XLogo className="w-4 h-4" />}
              title="Threads on X"
              subtitle="When I want to share something quickly without writing a full piece."
              action={{
                label: "Follow on X",
                href: "https://twitter.com/pranshurastogii",
              }}
            />
            {TWITTER_THREADS.length === 0 ? (
              <EmptyState label="threads" />
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-8">
                {TWITTER_THREADS.map((thread) => (
                  <TwitterThreadCard key={thread.id} thread={thread} />
                ))}
              </div>
            )}
          </section>

        </div>
      </main>

      <Footer />
    </HomeLayout>
  );
}
