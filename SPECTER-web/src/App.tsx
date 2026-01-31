import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { WalletProvider } from "@/components/WalletProvider";
import Index from "./pages/Index";
import GenerateKeys from "./pages/GenerateKeys";
import SendPayment from "./pages/SendPayment";
import ScanPayments from "./pages/ScanPayments";
import NotFound from "./pages/NotFound";

const App = () => (
  <WalletProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/generate" element={<GenerateKeys />} />
          <Route path="/send" element={<SendPayment />} />
          <Route path="/scan" element={<ScanPayments />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </WalletProvider>
);

export default App;
