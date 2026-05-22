import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { trackPageView } from "@/lib/analytics";

const PAGE_TITLES: Record<string, string> = {
  "/": "Home – SPECTER",
  "/setup": "Setup – SPECTER",
  "/send": "Send Payment – SPECTER",
  "/scan": "Scan Payments – SPECTER",
  "/yellow": "Yellow – SPECTER",
  "/usecases": "Use Cases – SPECTER",
  "/insights": "Insights – SPECTER",
};

export function usePageTracking() {
  const location = useLocation();

  useEffect(() => {
    const title = PAGE_TITLES[location.pathname] ?? "SPECTER";
    trackPageView(location.pathname + location.search, title);
  }, [location.pathname, location.search]);
}
