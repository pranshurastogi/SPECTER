import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { WalletProvider } from "@/components/WalletProvider";
import { AnimatedGridPattern } from "@/components/ui/animated-grid-pattern";
import Index from "./pages/Index";
import GenerateKeys from "./pages/GenerateKeys";
import SendPayment from "./pages/SendPayment";
import ScanPayments from "./pages/ScanPayments";
import YellowPage from "./pages/YellowPage";
import UseCasesPage from "./pages/UseCasesPage";
import NotFound from "./pages/NotFound";

const App = () => (
  <WalletProvider>
    <TooltipProvider delayDuration={300}>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <div className="relative min-h-screen bg-background">
          <AnimatedGridPattern
            numSquares={24}
            maxOpacity={0.06}
            duration={5}
            className="absolute inset-0 z-0 [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,white,transparent)]"
          />
          <div className="relative z-10">
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/setup" element={<GenerateKeys />} />
              <Route path="/send" element={<SendPayment />} />
              <Route path="/scan" element={<ScanPayments />} />
              <Route path="/yellow" element={<YellowPage />} />
              <Route path="/usecases" element={<UseCasesPage />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </div>
        </div>
      </BrowserRouter>
    </TooltipProvider>
  </WalletProvider>
);

export default App;
