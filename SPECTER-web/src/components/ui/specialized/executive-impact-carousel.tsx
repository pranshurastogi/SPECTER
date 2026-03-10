"use client";

import React, { useRef } from "react";
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
  icon: React.ReactNode;
  status: "live" | "coming_soon";
  ctaLabel?: string;
  ctaHref?: string;
  imageUrl?: string;
}

const USE_CASES: UseCaseItem[] = [
  {
    id: "trading",
    title: "Trading with Specter",
    description:
      "Anonymous offchain trading via Yellow Network. Route state channels through one time stealth addresses so counterparties stay unlinkable.",
    icon: (
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/20">
        <LineChart className="h-6 w-6" strokeWidth={1.75} />
      </span>
    ),
    status: "live",
    ctaLabel: "Explore Yellow App",
    ctaHref: "/yellow",
    imageUrl: "https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=400&h=250&fit=crop",
  },
  {
    id: "payroll",
    title: "Private Payroll & Salary Streaming",
    description:
      "Stream salaries to employees via stealth addresses. Payroll amounts and recipient identities stay confidential onchain.",
    icon: (
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/20">
        <Banknote className="h-6 w-6" strokeWidth={1.75} />
      </span>
    ),
    status: "coming_soon",
    ctaLabel: "Coming soon",
    imageUrl: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=400&h=250&fit=crop",
  },
  {
    id: "tipping",
    title: "Anonymous Tipping & Donations",
    description:
      "Accept tips and donations without exposing wallet addresses. Supporters pay to stealth addresses; only you can claim.",
    icon: (
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/20">
        <Gift className="h-6 w-6" strokeWidth={1.75} />
      </span>
    ),
    status: "coming_soon",
    ctaLabel: "Coming soon",
    imageUrl: "https://images.unsplash.com/photo-1532629345422-7515f3d16bb6?w=400&h=250&fit=crop",
  },
  {
    id: "nft-gating",
    title: "Stealth NFT Gating & Memberships",
    description:
      "Gate access to content or perks with NFT ownership while keeping holder identities private using stealth meta-addresses.",
    icon: (
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-500/20">
        <Lock className="h-6 w-6" strokeWidth={1.75} />
      </span>
    ),
    status: "coming_soon",
    ctaLabel: "Coming soon",
    imageUrl: "https://images.unsplash.com/photo-1644361566690-2f56644e2d2f?w=400&h=250&fit=crop",
  },
  {
    id: "otc",
    title: "Confidential OTC & Institutional Settlements",
    description:
      "Settle large OTC trades or institutional transfers without leaking counterparties or amounts on public ledgers.",
    icon: (
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/20">
        <Landmark className="h-6 w-6" strokeWidth={1.75} />
      </span>
    ),
    status: "coming_soon",
    ctaLabel: "Coming soon",
    imageUrl: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400&h=250&fit=crop",
  },
  {
    id: "dao",
    title: "Privacy preserving DAO payouts",
    description:
      "Distribute grants, rewards, or revenue to DAO members via stealth addresses so recipient lists stay private.",
    icon: (
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-400 ring-1 ring-violet-500/20">
        <UsersRound className="h-6 w-6" strokeWidth={1.75} />
      </span>
    ),
    status: "coming_soon",
    ctaLabel: "Coming soon",
    imageUrl: "https://images.unsplash.com/photo-1642790106117-e829e14a795f?w=400&h=250&fit=crop",
  },
];

const COL_1 = USE_CASES.slice(0, 2);
const COL_2 = USE_CASES.slice(2, 4);
const COL_3 = USE_CASES.slice(4, 6);

const styles = `
  .usecases-carousel {
    background-color: transparent;
    color: var(--foreground);
    font-family: inherit;
    margin: 0;
    overflow-x: hidden;
  }

  .usecases-col-scroll {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    justify-items: center;
    width: 90vw;
    max-width: 1400px;
    margin: 0 auto;
    box-sizing: border-box;
    padding: 2rem 0 4rem;
    gap: 2rem;
    align-items: start;
  }

  @media (max-width: 768px) {
    .usecases-col-scroll {
      display: flex;
      flex-direction: column;
      width: 100%;
      padding: 1rem 0 3rem;
      gap: 2rem;
      align-items: center;
      min-height: auto;
    }
  }

  .usecases-col-scroll__box {
    display: flex;
    flex-direction: column;
    padding: 0 0 2rem;
  }

  .usecases-col-scroll__box--odd {
    flex-direction: column-reverse;
  }

  @media (max-width: 768px) {
    .usecases-col-scroll__box--odd {
      flex-direction: column;
      padding: 0;
    }
    .usecases-col-scroll__box {
      width: 100%;
      align-items: center;
      padding: 1rem 0;
    }
  }

  .usecases-col-scroll__list {
    display: flex;
    flex-direction: column;
    gap: 2.5rem;
  }

  .usecases-col-scroll__box--odd .usecases-col-scroll__list {
    flex-direction: column-reverse;
  }

  @media (max-width: 768px) {
    .usecases-col-scroll__box--odd .usecases-col-scroll__list {
      flex-direction: column;
    }
    .usecases-col-scroll__list {
      gap: 2rem;
    }
  }

  .usecase-card {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    margin: 0;
    padding: 0;
    width: 20vw;
    min-width: 260px;
    max-width: 340px;
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border));
    border-radius: 1rem;
    cursor: default;
    overflow: hidden;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .usecase-card:hover {
    border-color: hsl(var(--primary) / 0.4);
    box-shadow: 0 8px 30px hsl(var(--primary) / 0.08);
  }

  .usecase-card--live:hover {
    border-color: rgba(234, 179, 8, 0.5);
    box-shadow: 0 8px 30px rgba(234, 179, 8, 0.12);
  }

  @media (max-width: 768px) {
    .usecase-card {
      width: 90vw;
      max-width: 400px;
      min-width: unset;
    }
  }

  .usecase-card__img-wrap {
    aspect-ratio: 16/10;
    width: 100%;
    background: linear-gradient(135deg, hsl(var(--muted)) 0%, hsl(var(--muted) / 0.7) 100%);
    overflow: hidden;
  }

  .usecase-card__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .usecase-card__img-wrap img.usecase-card__img--error {
    display: none;
  }

  .usecase-card__body {
    padding: 1.25rem 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .usecase-card__icon {
    margin-bottom: 0.25rem;
  }

  .usecase-card__title {
    margin: 0;
    font-weight: 600;
    font-size: 1.1rem;
    line-height: 1.3;
    color: hsl(var(--foreground));
  }

  .usecase-card__desc {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: hsl(var(--muted-foreground));
  }

  .usecase-card__cta {
    margin-top: auto;
    padding-top: 0.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 600;
    transition: all 0.2s ease;
    text-decoration: none;
    border: none;
    cursor: pointer;
  }

  .usecase-card__cta--live {
    background: rgb(234, 179, 8);
    color: rgb(0, 0, 0);
  }

  .usecase-card__cta--live:hover {
    background: rgb(202, 138, 4);
  }

  .usecase-card__cta--soon {
    background: transparent;
    color: hsl(var(--muted-foreground));
    border: 1px solid hsl(var(--border));
    cursor: default;
    font-weight: 500;
  }
`;

function UseCaseCard({ item }: { item: UseCaseItem }) {
  const [imgError, setImgError] = React.useState(false);
  const isLive = item.status === "live";
  const Cta = item.ctaHref ? (
    <Link
      to={item.ctaHref}
      className={`usecase-card__cta usecase-card__cta--live`}
    >
      {item.ctaLabel}
      <ArrowRight className="w-4 h-4" />
    </Link>
  ) : (
    <span className="usecase-card__cta usecase-card__cta--soon" aria-disabled="true">
      <Clock className="w-4 h-4 shrink-0" />
      {item.ctaLabel ?? "Coming soon"}
    </span>
  );

  return (
    <article
      className={`usecase-card ${isLive ? "usecase-card--live" : ""}`}
      data-status={item.status}
    >
      {item.imageUrl && (
        <div className="usecase-card__img-wrap">
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            className={`usecase-card__img ${imgError ? "usecase-card__img--error" : ""}`}
            onError={() => setImgError(true)}
          />
        </div>
      )}
      <div className="usecase-card__body">
        <div className="usecase-card__icon">{item.icon}</div>
        <h3 className="usecase-card__title">{item.title}</h3>
        <p className="usecase-card__desc">{item.description}</p>
        {Cta}
      </div>
    </article>
  );
}

export default function UseCasesCarousel() {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <section className="usecases-carousel">
        <div ref={containerRef} className="usecases-col-scroll">
          <div className="usecases-col-scroll__box usecases-col-scroll__box--odd">
            <div className="usecases-col-scroll__list">
              {COL_1.map((item) => (
                <UseCaseCard key={item.id} item={item} />
              ))}
            </div>
          </div>
          <div className="usecases-col-scroll__box">
            <div className="usecases-col-scroll__list">
              {COL_2.map((item) => (
                <UseCaseCard key={item.id} item={item} />
              ))}
            </div>
          </div>
          <div className="usecases-col-scroll__box usecases-col-scroll__box--odd">
            <div className="usecases-col-scroll__list">
              {COL_3.map((item) => (
                <UseCaseCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
