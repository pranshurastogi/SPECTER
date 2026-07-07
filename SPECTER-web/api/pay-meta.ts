import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PostHog } from "posthog-node";

function esc(s: string): string {
  return String(s)
    .slice(0, 120)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const posthogKey = process.env.VITE_PUBLIC_POSTHOG_KEY;
  const posthogHost = process.env.VITE_PUBLIC_POSTHOG_HOST;
  const posthog = posthogKey && posthogHost
    ? new PostHog(posthogKey, { host: posthogHost, enableExceptionAutocapture: true, flushAt: 1, flushInterval: 0 })
    : null;

  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? req.headers.host ?? "specterpq.com";
  const proto = (req.headers["x-forwarded-proto"] as string) ?? "https";
  const base = `${proto}://${host}`;

  const q = req.query;
  const rawName = (Array.isArray(q.name) ? q.name[0] : q.name) ?? "someone";
  const rawAmount = (Array.isArray(q.amount) ? q.amount[0] : q.amount) ?? "";
  const rawChain = (Array.isArray(q.chain) ? q.chain[0] : q.chain) ?? "";
  const rawLabel = (Array.isArray(q.label) ? q.label[0] : q.label) ?? "";

  // Escaped values for the HTML context (title/desc/meta tags).
  const name = esc(rawName);
  const amount = esc(rawAmount);
  const chain = esc(rawChain);
  const label = esc(rawLabel);

  const title = amount ? `Pay ${amount} ${chain.toUpperCase()} to ${name}` : `Pay ${name} privately on SPECTER`;
  const desc = label
    ? `${label} — paid privately with a fresh post-quantum stealth address. No address reuse.`
    : `Send ${name} a private payment. Every payer gets a fresh, unlinkable post-quantum stealth address.`;
  // Static branded preview card (1200x630). The per-name title/description below
  // carry the dynamic context; the image stays a fixed asset for build reliability.
  const ogImage = `${base}/og-pay-card.png`;

  // Pull the built SPA shell (a real static file — not rewritten) and inject meta into <head>.
  let html = "<!doctype html><html><head></head><body><div id=\"root\"></div></body></html>";
  try {
    const shell = await fetch(`${base}/index.html`);
    if (shell.ok) html = await shell.text();
  } catch (error) {
    posthog?.captureException(error, "pay_meta_preview", {
      endpoint: "/api/pay-meta",
      stage: "load_shell",
      $process_person_profile: false,
    });
  }

  const tags = `
    <title>${title}</title>
    <meta name="description" content="${desc}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:image" content="${ogImage}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${desc}" />
    <meta name="twitter:image" content="${ogImage}" />
  `;

  const injected = html.includes("</head>") ? html.replace("</head>", `${tags}</head>`) : html + tags;

  try {
    posthog?.capture({
      distinctId: "pay_meta_preview",
      event: "pay_meta_rendered",
      properties: {
        endpoint: "/api/pay-meta",
        has_amount: Boolean(rawAmount),
        has_label: Boolean(rawLabel),
        has_chain: Boolean(rawChain),
        $process_person_profile: false,
      },
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=86400");
    res.status(200).send(injected);
  } catch (error) {
    posthog?.captureException(error, "pay_meta_preview", {
      endpoint: "/api/pay-meta",
      stage: "respond",
      $process_person_profile: false,
    });
    posthog?.capture({
      distinctId: "pay_meta_preview",
      event: "pay_meta_render_failed",
      properties: {
        endpoint: "/api/pay-meta",
        stage: "respond",
        $process_person_profile: false,
      },
    });
    throw error;
  } finally {
    await posthog?.shutdown();
  }
}
