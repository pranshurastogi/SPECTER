import { useEffect, useMemo } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import SendPayment from "./SendPayment";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/base/button";
import { parsePayParams, isValidRecipientName, type PayLinkConfig } from "@/lib/payLink";
import { analytics } from "@/lib/analytics";

export default function PayPage() {
  const { name = "" } = useParams();
  const [searchParams] = useSearchParams();

  const valid = isValidRecipientName(name);
  const payLink: PayLinkConfig | null = useMemo(
    () => (valid ? { recipient: name.toLowerCase(), ...parsePayParams(searchParams) } : null),
    [valid, name, searchParams]
  );

  useEffect(() => {
    if (!payLink) {
      analytics.payPageInvalidName();
      return;
    }
    analytics.payPageViewed({
      name_type: payLink.recipient.endsWith(".sui") ? "sui" : "ens",
      has_amount: Boolean(payLink.amount),
      chain: payLink.chain ?? "",
      ref: payLink.ref ?? "",
    });
  }, [payLink]);

  if (!payLink) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 pt-48 pb-12 flex flex-col items-center justify-center text-center px-4">
          <h1 className="text-xl font-semibold mb-2">Invalid pay link</h1>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm">
            "{name}" isn't a valid ENS or SuiNS name. A SPECTER pay link looks like
            <span className="font-mono"> specterpq.com/pay/alice.eth</span>.
          </p>
          <Button asChild><Link to="/send">Go to Send</Link></Button>
        </main>
        <Footer />
      </div>
    );
  }

  return <SendPayment payLink={payLink} />;
}
