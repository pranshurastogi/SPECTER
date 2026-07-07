import * as React from "react";
import { Link } from "react-router-dom";
import {
  LineChart,
  Banknote,
  Gift,
  Lock,
  Landmark,
  UsersRound,
  ArrowRight,
  Sparkles,
  Clock,
} from "lucide-react";
import { HomeLayout } from "@/components/layout/HomeLayout";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CardStack, type CardStackItem } from "@/components/ui/card-stack";
import { GlowCard } from "@/components/ui/spotlight-card";

type LucideIcon = React.ComponentType<{ className?: string; strokeWidth?: number }>;

type UseCaseCardItem = CardStackItem & {
  status: "live" | "coming_soon";
  Icon: LucideIcon;
  glow: "blue" | "purple" | "green" | "red" | "orange";
};

const IMG = (id: string) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=900&q=80`;

const USE_CASES: UseCaseCardItem[] = [
  {
    id: "trading",
    title: "Trading with Specter",
    description:
      "Anonymous offchain trading via Yellow Network — route state channels through one-time stealth addresses.",
    imageSrc: IMG("1639762681485-074b7f938ba0"),
    href: "/yellow",
    ctaLabel: "Explore Yellow app",
    status: "live",
    Icon: LineChart,
    glow: "orange",
  },
  {
    id: "payroll",
    title: "Private payroll & salary streaming",
    description:
      "Stream salaries via stealth addresses. Amounts and recipient identities stay confidential onchain.",
    imageSrc: IMG("1554224155-6726b3ff858f"),
    status: "coming_soon",
    Icon: Banknote,
    glow: "purple",
  },
  {
    id: "tipping",
    title: "Anonymous tipping & donations",
    description:
      "Accept tips without exposing wallet addresses. Supporters pay to stealth addresses; only you can claim.",
    imageSrc: IMG("1532629345422-7515f3d16bb6"),
    status: "coming_soon",
    Icon: Gift,
    glow: "red",
  },
  {
    id: "nft-gating",
    title: "Stealth NFT gating & memberships",
    description:
      "Gate content or perks by NFT ownership while keeping holder identities private with stealth meta-addresses.",
    imageSrc: IMG("1644361566690-2f56644e2d2f"),
    status: "coming_soon",
    Icon: Lock,
    glow: "blue",
  },
  {
    id: "otc",
    title: "Confidential OTC & institutional settlement",
    description:
      "Settle large OTC trades or institutional transfers without leaking counterparties or amounts.",
    imageSrc: IMG("1611974789855-9c2a0a7236a3"),
    status: "coming_soon",
    Icon: Landmark,
    glow: "green",
  },
  {
    id: "dao",
    title: "Privacy-preserving DAO payouts",
    description:
      "Distribute grants, rewards, or revenue to DAO members via stealth addresses so recipient lists stay private.",
    imageSrc: IMG("1642790106117-e829e14a795f"),
    status: "coming_soon",
    Icon: UsersRound,
    glow: "purple",
  },
];

/** CardStack uses fixed px sizing, so we size responsively from the viewport. */
function useStackSize() {
  const [w, setW] = React.useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1024,
  );
  React.useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (w < 480)
    return { cardWidth: 288, cardHeight: 384, overlap: 0.64, spreadDeg: 26 };
  if (w < 768)
    return { cardWidth: 360, cardHeight: 300, overlap: 0.56, spreadDeg: 40 };
  return { cardWidth: 460, cardHeight: 300, overlap: 0.5, spreadDeg: 46 };
}

function UseCaseFace({ item, active }: { item: UseCaseCardItem; active: boolean }) {
  const { Icon } = item;
  const isLive = item.status === "live";

  return (
    <GlowCard
      customSize
      glowColor={item.glow}
      className="h-full w-full !p-0 !gap-0 !rounded-2xl overflow-hidden"
    >
      <div className="relative h-full w-full">
        <img
          src={item.imageSrc}
          alt=""
          draggable={false}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/* readability wash */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/55 to-zinc-950/5" />

        {/* status pill */}
        <div className="absolute left-3 top-3">
          {isLive ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-wide text-amber-300 ring-1 ring-amber-500/40 backdrop-blur">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
              </span>
              Live
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-black/50 px-2.5 py-1 text-[0.68rem] font-medium uppercase tracking-wide text-zinc-300 ring-1 ring-white/15 backdrop-blur">
              <Clock className="h-3 w-3" />
              Coming soon
            </span>
          )}
        </div>

        {/* content */}
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/20 backdrop-blur">
            <Icon className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <h3 className="text-base font-semibold leading-snug text-white">
            {item.title}
          </h3>
          <p className="line-clamp-2 text-sm leading-relaxed text-white/75">
            {item.description}
          </p>

          {isLive && item.href ? (
            active ? (
              <Link
                to={item.href}
                className="mt-1 inline-flex h-9 w-fit items-center gap-1.5 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-black transition-colors hover:bg-amber-600"
              >
                {item.ctaLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <span className="mt-1 inline-flex h-9 w-fit items-center gap-1.5 rounded-lg bg-amber-500/90 px-4 text-sm font-semibold text-black">
                {item.ctaLabel}
                <ArrowRight className="h-4 w-4" />
              </span>
            )
          ) : null}
        </div>
      </div>
    </GlowCard>
  );
}

export default function UseCasesPage() {
  const stack = useStackSize();

  return (
    <HomeLayout>
      <Header />

      <main className="pt-24 sm:pt-28 pb-16 sm:pb-20 px-4 sm:px-6">
        {/* Hero: Trading with Specter (Yellow) — the one live use case */}
        <section className="max-w-4xl mx-auto mb-16 sm:mb-24">
          <div className="rounded-3xl border border-amber-500/20 bg-zinc-950/60 shadow-xl overflow-hidden">
            <div className="grid md:grid-cols-[1fr,minmax(260px,38%)]">
              <div className="p-8 sm:p-10 flex flex-col justify-center">
                <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest w-fit mb-5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
                  </span>
                  Live on Yellow Network
                </div>
                <h1 className="text-3xl sm:text-4xl lg:text-[2.6rem] font-black tracking-tight text-zinc-100 mb-3 leading-tight">
                  Trading with Specter
                </h1>
                <p className="text-muted-foreground text-base sm:text-lg leading-relaxed mb-5">
                  Anonymous offchain trading powered by post-quantum stealth addresses.
                  Route state channels through one-time stealth addresses so counterparties
                  stay unlinkable — nobody sees who trades with whom.
                </p>
                <p className="text-sm text-muted-foreground mb-8">
                  Create channels, fund with USDC, send payments, and settle to your
                  stealth address on Sepolia — all without exposing your identity.
                </p>
                <Link
                  to="/yellow"
                  className="inline-flex items-center justify-center gap-2 rounded-xl py-3.5 px-7 bg-amber-500 hover:bg-amber-600 text-black font-semibold text-base transition-colors w-full sm:w-fit"
                >
                  <LineChart className="w-5 h-5" strokeWidth={2} />
                  Explore Yellow app
                  <ArrowRight className="w-5 h-5" />
                </Link>
              </div>

              {/* Signature panel: stealth-channel motif instead of a stock photo */}
              <div className="relative min-h-[180px] md:min-h-0 flex items-center justify-center p-8 border-t md:border-t-0 md:border-l border-amber-500/10 bg-gradient-to-br from-amber-500/[0.07] to-transparent overflow-hidden">
                <div
                  className="pointer-events-none absolute inset-0 opacity-40"
                  style={{
                    backgroundImage:
                      "linear-gradient(rgba(245,158,11,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(245,158,11,0.12) 1px, transparent 1px)",
                    backgroundSize: "26px 26px",
                    maskImage:
                      "radial-gradient(circle at 50% 50%, black, transparent 70%)",
                    WebkitMaskImage:
                      "radial-gradient(circle at 50% 50%, black, transparent 70%)",
                  }}
                  aria-hidden
                />
                <div className="relative rounded-2xl border border-amber-500/25 bg-zinc-950/70 ring-1 ring-amber-500/10 px-5 py-6 text-center backdrop-blur-sm">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25 mx-auto mb-3">
                    <LineChart className="h-6 w-6" strokeWidth={1.75} />
                  </span>
                  <p className="text-sm font-semibold text-amber-400">SPECTER × Yellow</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Private state-channel trading
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section header — matches the amber divider used across the app */}
        <div className="max-w-5xl mx-auto mb-8">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-amber-500/10 ring-1 ring-amber-500/20 text-amber-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <h2 className="text-2xl font-bold text-zinc-100 tracking-tight">
              What you can build with Specter
            </h2>
          </div>
          <p className="text-sm text-zinc-500 pl-0 sm:pl-12 max-w-xl mt-2">
            Drag, swipe, or tap through the deck — every idea is built on stealth
            addresses and private routing.
          </p>
          <div className="h-px bg-gradient-to-r from-amber-500/40 via-amber-400/10 to-transparent mt-4" />
        </div>

        {/* Use-case deck (fanned 3D stack with spotlight cards) */}
        <section className="max-w-5xl mx-auto">
          <CardStack<UseCaseCardItem>
            items={USE_CASES}
            initialIndex={0}
            loop
            autoAdvance
            intervalMs={4200}
            pauseOnHover
            showDots
            cardWidth={stack.cardWidth}
            cardHeight={stack.cardHeight}
            overlap={stack.overlap}
            spreadDeg={stack.spreadDeg}
            renderCard={(item, { active }) => (
              <UseCaseFace item={item} active={active} />
            )}
          />
        </section>
      </main>

      <Footer />
    </HomeLayout>
  );
}
