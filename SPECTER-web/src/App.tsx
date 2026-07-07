import { Toaster } from "@/components/ui/base/toaster";
import { Toaster as Sonner } from "@/components/ui/base/sonner";
import { TooltipProvider } from "@/components/ui/base/tooltip";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useEffect, useRef } from "react";
import { WalletProvider } from "@/components/features/wallet/WalletProvider";
import { usePageTracking } from "@/hooks/usePageTracking";
import { AnimatedGridPattern } from "@/components/ui/animations/animated-grid-pattern";
import { Analytics } from "@vercel/analytics/react";
import { WalkthroughVideoPrompt } from "@/components/features/WalkthroughVideoPrompt";
import { FeedbackBubble } from "@/components/features/FeedbackBubble";
import { ErrorBoundary } from "@/components/features/ErrorBoundary";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { identifyWalletUser, resetPostHogUser } from "@/lib/analytics";
import Index from "./pages/Index";
import GenerateKeys from "./pages/GenerateKeys";
import SendPayment from "./pages/SendPayment";
import ScanPayments from "./pages/ScanPayments";
import YellowPage from "./pages/YellowPage";
import UseCasesPage from "./pages/UseCasesPage";
import InsightsPage from "./pages/InsightsPage";
import NotFound from "./pages/NotFound";
import PayPage from "./pages/PayPage";
import TrustlessRecovery from "./pages/TrustlessRecovery";
import SelfHost from "./pages/SelfHost";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function RouteTracker() {
  usePageTracking();
  return null;
}

function WalletIdentityTracker() {
  const { primaryWallet } = useDynamicContext();
  const lastWalletAddressRef = useRef<string | null>(null);

  useEffect(() => {
    const walletAddress = primaryWallet?.address?.toLowerCase() ?? null;

    if (!walletAddress) {
      if (lastWalletAddressRef.current) {
        resetPostHogUser();
      }
      lastWalletAddressRef.current = null;
      return;
    }

    if (lastWalletAddressRef.current === walletAddress) {
      return;
    }

    identifyWalletUser(`wallet:${walletAddress}`, {
      wallet_connected: true,
      wallet_provider_present: Boolean(primaryWallet?.connector),
    });
    lastWalletAddressRef.current = walletAddress;
  }, [primaryWallet]);

  return null;
}

const App = () => (
  <WalletProvider>
    <TooltipProvider delayDuration={300}>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <WalletIdentityTracker />
        <div className="relative min-h-screen bg-background">
          <AnimatedGridPattern
            numSquares={124}
            maxOpacity={0.09}
            duration={10}
            className="absolute inset-0 z-0 [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%_at_50%_50%,white,transparent)]"
          />
          <div className="relative z-10">
            <ScrollToTop />
            <RouteTracker />
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/setup" element={<GenerateKeys />} />
                <Route path="/send" element={<SendPayment />} />
                <Route path="/scan" element={<ScanPayments />} />
                <Route path="/yellow" element={<YellowPage />} />
                <Route path="/usecases" element={<UseCasesPage />} />
                <Route path="/insights" element={<InsightsPage />} />
                <Route path="/pay/:name" element={<PayPage />} />
                <Route path="/i-dont-trust-specter" element={<TrustlessRecovery />} />
                <Route path="/self-host" element={<SelfHost />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </ErrorBoundary>
          </div>
          <WalkthroughVideoPrompt />
          <FeedbackBubble />
          <Analytics />
        </div>
      </BrowserRouter>
    </TooltipProvider>
  </WalletProvider>
);

export default App;
