import { Link } from "react-router-dom";
import { LineChart, ArrowRight } from "lucide-react";
import UseCasesCarousel from "@/components/ui/executive-impact-carousel";

export default function UseCasesPage() {
  return (
    <div className="min-h-screen pt-24 pb-8 px-4">
      {/* Hero: Trading with Specter (Yellow) — focus section */}
      <section className="max-w-4xl mx-auto mb-16 sm:mb-24">
        <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 shadow-xl overflow-hidden">
          <div className="grid md:grid-cols-[1fr,minmax(280px,40%)] gap-0">
            <div className="p-8 sm:p-10 flex flex-col justify-center">
              <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/20 px-3 py-1.5 text-xs font-medium w-fit mb-4">
                <LineChart className="w-3.5 h-3.5" strokeWidth={2} />
                Live on Yellow Network
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-3">
                Trading with Specter
              </h1>
              <p className="text-muted-foreground text-base sm:text-lg leading-relaxed mb-6">
                Anonymous offchain trading powered by post-quantum stealth addresses.
                Route state channels through one time stealth addresses so counterparties
                stay unlinkable; nobody sees who trades with whom.
              </p>
              <p className="text-sm text-muted-foreground mb-8">
                Create channels, fund with USDC, send payments, and settle to your
                stealth address on Sepolia — all without exposing your identity.
              </p>
              <Link
                to="/yellow"
                className="inline-flex items-center justify-center gap-2 rounded-xl py-4 px-8 bg-yellow-500 hover:bg-yellow-600 text-black font-semibold text-lg transition-colors w-full sm:w-auto"
              >
                <LineChart className="w-5 h-5" strokeWidth={2} />
                Explore Yellow App
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
            <div className="relative min-h-[180px] md:min-h-0 bg-muted/50 flex items-center justify-center p-6">
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 ring-1 ring-amber-500/10 p-5 text-center max-w-[180px]">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/20 mx-auto mb-2">
                  <LineChart className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <p className="text-xs font-medium text-amber-400">SPECTER × Yellow</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Private state channel trading
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section title */}
      <div className="max-w-6xl mx-auto mb-8 px-2">
        <h2 className="text-2xl font-bold text-foreground text-center">
          What you can build with Specter
        </h2>
        <p className="text-muted-foreground text-center mt-2 max-w-xl mx-auto">
          More use cases we’re excited about — build on stealth addresses and private routing.
        </p>
      </div>

      {/* Carousel of use cases (Trading + 5 coming soon) */}
      <UseCasesCarousel />
    </div>
  );
}
