import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

function esc(s: string): string {
  return s.replace(/[<>&]/g, "").slice(0, 80);
}

export default function handler(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = esc(searchParams.get("name") || "someone");
  const amount = esc(searchParams.get("amount") || "");
  const chain = esc(searchParams.get("chain") || "");
  const label = esc(searchParams.get("label") || "");

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#0a0a0a",
          color: "#fafafa",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 28, color: "#a1a1aa", display: "flex" }}>SPECTER · private payments</div>
        <div style={{ fontSize: 80, fontWeight: 800, marginTop: 24, display: "flex" }}>
          Pay {name}
        </div>
        {amount ? (
          <div style={{ fontSize: 48, marginTop: 16, color: "#22d3ee", display: "flex" }}>
            {amount} {chain ? chain.toUpperCase() : ""}
          </div>
        ) : null}
        {label ? (
          <div style={{ fontSize: 32, marginTop: 12, color: "#d4d4d8", display: "flex" }}>{label}</div>
        ) : null}
        <div style={{ fontSize: 26, marginTop: 48, color: "#a1a1aa", display: "flex" }}>
          🛡 Stealth address · 🔒 Post-quantum · specterpq.com
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
