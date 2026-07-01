"use client";

import React from "react";
import { Link } from "react-router-dom";
import {
  LineChart,
  Banknote,
  Gift,
  Lock,
  Landmark,
  UsersRound,
  ArrowRight,
  Clock,
} from "lucide-react";

export interface UseCaseItem {
  id: string;
  title: string;
  description: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Accent color (hex) — tints the header band, icon chip and hover ring. */
  accent: string;
  status: "live" | "coming_soon";
  ctaLabel?: string;
  ctaHref?: string;
}

const USE_CASES: UseCaseItem[] = [
  {
    id: "trading",
    title: "Trading with Specter",
    description:
      "Anonymous offchain trading via Yellow Network. Route state channels through one-time stealth addresses so counterparties stay unlinkable.",
    Icon: LineChart,
    accent: "#f59e0b",
    status: "live",
    ctaLabel: "Explore Yellow app",
    ctaHref: "/yellow",
  },
  {
    id: "payroll",
    title: "Private payroll & salary streaming",
    description:
      "Stream salaries to employees via stealth addresses. Amounts and recipient identities stay confidential onchain.",
    Icon: Banknote,
    accent: "#8b5cf6",
    status: "coming_soon",
  },
  {
    id: "tipping",
    title: "Anonymous tipping & donations",
    description:
      "Accept tips and donations without exposing wallet addresses. Supporters pay to stealth addresses; only you can claim.",
    Icon: Gift,
    accent: "#fb7185",
    status: "coming_soon",
  },
  {
    id: "nft-gating",
    title: "Stealth NFT gating & memberships",
    description:
      "Gate content or perks by NFT ownership while keeping holder identities private using stealth meta-addresses.",
    Icon: Lock,
    accent: "#22d3ee",
    status: "coming_soon",
  },
  {
    id: "otc",
    title: "Confidential OTC & institutional settlement",
    description:
      "Settle large OTC trades or institutional transfers without leaking counterparties or amounts on public ledgers.",
    Icon: Landmark,
    accent: "#34d399",
    status: "coming_soon",
  },
  {
    id: "dao",
    title: "Privacy-preserving DAO payouts",
    description:
      "Distribute grants, rewards, or revenue to DAO members via stealth addresses so recipient lists stay private.",
    Icon: UsersRound,
    accent: "#a78bfa",
    status: "coming_soon",
  },
];

const styles = `
  .uc-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1.5rem;
    width: 100%;
    max-width: 1120px;
    margin: 0 auto;
    padding: 0;
    box-sizing: border-box;
  }

  @media (max-width: 1024px) {
    .uc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }

  @media (max-width: 640px) {
    .uc-grid { grid-template-columns: minmax(0, 1fr); gap: 1.25rem; }
  }

  .uc-card {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border));
    border-radius: 1rem;
    overflow: hidden;
    transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
  }

  .uc-card:hover {
    transform: translateY(-3px);
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
    box-shadow: 0 12px 34px -12px color-mix(in srgb, var(--accent) 45%, transparent);
  }

  /* Header band: dark base + soft accent glow + watermark icon */
  .uc-card__band {
    position: relative;
    height: 104px;
    background:
      radial-gradient(120% 120% at 20% 10%, color-mix(in srgb, var(--accent) 22%, transparent) 0%, transparent 60%),
      linear-gradient(180deg, hsl(var(--muted) / 0.35) 0%, hsl(var(--card)) 100%);
    overflow: hidden;
  }

  .uc-card__band::after {
    content: "";
    position: absolute;
    inset: 0;
    background-image: linear-gradient(hsl(var(--border) / 0.25) 1px, transparent 1px),
      linear-gradient(90deg, hsl(var(--border) / 0.25) 1px, transparent 1px);
    background-size: 22px 22px;
    -webkit-mask-image: radial-gradient(120% 120% at 20% 10%, black, transparent 65%);
    mask-image: radial-gradient(120% 120% at 20% 10%, black, transparent 65%);
    opacity: 0.5;
  }

  .uc-card__watermark {
    position: absolute;
    right: -12px;
    bottom: -18px;
    color: var(--accent);
    opacity: 0.16;
  }

  .uc-card__status {
    position: absolute;
    top: 0.75rem;
    left: 0.75rem;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.6rem;
    border-radius: 999px;
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    backdrop-filter: blur(4px);
  }

  .uc-card__status--live {
    color: #fcd34d;
    background: rgba(245, 158, 11, 0.14);
    border: 1px solid rgba(245, 158, 11, 0.35);
  }

  .uc-card__status--soon {
    color: hsl(var(--muted-foreground));
    background: hsl(var(--muted) / 0.5);
    border: 1px solid hsl(var(--border));
  }

  .uc-card__dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: #f59e0b;
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.6);
    animation: uc-pulse 1.8s ease-out infinite;
  }

  @keyframes uc-pulse {
    0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.55); }
    70% { box-shadow: 0 0 0 7px rgba(245, 158, 11, 0); }
    100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
  }

  .uc-card__body {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 1.25rem 1.25rem 1.4rem;
    flex: 1;
  }

  .uc-card__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    margin-top: -2.4rem;
    border-radius: 0.85rem;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, hsl(var(--card)));
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    box-shadow: 0 6px 16px -8px color-mix(in srgb, var(--accent) 60%, transparent);
  }

  .uc-card__title {
    margin: 0.15rem 0 0;
    font-weight: 600;
    font-size: 1.02rem;
    line-height: 1.3;
    color: hsl(var(--foreground));
  }

  .uc-card__desc {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.5;
    color: hsl(var(--muted-foreground));
  }

  .uc-card__cta {
    margin-top: auto;
    padding-top: 0.4rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    width: 100%;
    height: 2.5rem;
    border-radius: 0.6rem;
    font-size: 0.85rem;
    font-weight: 600;
    text-decoration: none;
    transition: background 0.2s ease, color 0.2s ease;
  }

  .uc-card__cta--live {
    background: rgb(234, 179, 8);
    color: rgb(0, 0, 0);
  }

  .uc-card__cta--live:hover { background: rgb(202, 138, 4); }

  .uc-card__cta--soon {
    background: hsl(var(--muted) / 0.4);
    color: hsl(var(--muted-foreground));
    border: 1px solid hsl(var(--border));
    font-weight: 500;
    cursor: default;
  }
`;

function UseCaseCard({ item }: { item: UseCaseItem }) {
  const { Icon } = item;
  const isLive = item.status === "live";

  return (
    <article
      className="uc-card"
      style={{ ["--accent" as string]: item.accent } as React.CSSProperties}
      data-status={item.status}
    >
      <div className="uc-card__band">
        <div className="uc-card__watermark" aria-hidden>
          <Icon className="h-24 w-24" strokeWidth={1.25} />
        </div>
        {isLive ? (
          <span className="uc-card__status uc-card__status--live">
            <span className="uc-card__dot" />
            Live
          </span>
        ) : (
          <span className="uc-card__status uc-card__status--soon">Coming soon</span>
        )}
      </div>

      <div className="uc-card__body">
        <span className="uc-card__icon">
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <h3 className="uc-card__title">{item.title}</h3>
        <p className="uc-card__desc">{item.description}</p>

        {item.ctaHref ? (
          <Link to={item.ctaHref} className="uc-card__cta uc-card__cta--live">
            {item.ctaLabel}
            <ArrowRight className="w-4 h-4" />
          </Link>
        ) : (
          <span className="uc-card__cta uc-card__cta--soon" aria-disabled="true">
            <Clock className="w-4 h-4 shrink-0" />
            {item.ctaLabel ?? "Coming soon"}
          </span>
        )}
      </div>
    </article>
  );
}

export default function UseCasesCarousel() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="uc-grid">
        {USE_CASES.map((item) => (
          <UseCaseCard key={item.id} item={item} />
        ))}
      </div>
    </>
  );
}
