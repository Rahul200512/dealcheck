import { ImageResponse } from "next/og";

// link preview card for slack, linkedin, imessage and x
export const alt = "DealCheck — Is this used car a good deal?";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ratings = [
  { label: "Great deal", bg: "#059669" },
  { label: "Fair price", bg: "#334155" },
  { label: "Above market", bg: "#f59e0b" },
  { label: "Overpriced", bg: "#e11d48" },
];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "radial-gradient(circle at 75% 20%, #4c1d95 0%, #0b0b1e 55%)",
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
            }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 17h14M6.5 17a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm14 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM3.5 17v-4l2-5h13l2 5v4M5.5 13h13" />
            </svg>
          </div>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700 }}>
            Deal<span style={{ color: "#a5b4fc" }}>Check</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>
            Is that used car a good deal?
          </div>
          <div style={{ display: "flex", fontSize: 32, color: "#cbd5e1", maxWidth: 980 }}>
            Paste a listing, add the asking price, and get a fair-price estimate, a deal rating and what moves the price.
          </div>
        </div>

        <div style={{ display: "flex", gap: 16 }}>
          {ratings.map((r) => (
            <div key={r.label} style={{ display: "flex", padding: "12px 26px", borderRadius: 999, background: r.bg, fontSize: 26, fontWeight: 600 }}>
              {r.label}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
