"use client";

import { formatUsd } from "@/lib/format";
import type { DealRating, DealVerdict, PriceFactor } from "@/ml/deal";

const TONES: Record<DealRating, { box: string; badge: string }> = {
  great: { box: "border-emerald-200 bg-emerald-50", badge: "bg-emerald-600 text-white" },
  good: { box: "border-emerald-200 bg-emerald-50/60", badge: "bg-emerald-500 text-white" },
  fair: { box: "border-slate-200 bg-white", badge: "bg-slate-700 text-white" },
  high: { box: "border-amber-200 bg-amber-50", badge: "bg-amber-500 text-white" },
  overpriced: { box: "border-rose-200 bg-rose-50", badge: "bg-rose-600 text-white" },
};

export function DealCard({ deal, factors }: { deal: DealVerdict; factors: PriceFactor[] }) {
  // a suspiciously low price is a warning, not a win
  const tone = deal.too_good_to_be_true ? TONES.high : TONES[deal.rating];
  const label = deal.too_good_to_be_true ? "Suspiciously low" : deal.label;
  return (
    <section className={`rounded-3xl border p-6 shadow-sm ${tone.box}`} aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${tone.badge}`}>{label}</span>
        <span className="text-sm text-slate-600">
          asking <span className="font-semibold text-slate-900">{formatUsd(deal.asking_price)}</span> · fair{" "}
          <span className="font-semibold text-slate-900">{formatUsd(deal.fair_price)}</span>
        </span>
      </div>
      <p className="mt-3 text-sm text-slate-700">{deal.summary}</p>
      {deal.too_good_to_be_true && (
        <p className="mt-3 rounded-xl bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900" role="alert">
          Price looks too good to be true. Ask for a vehicle history report first.
        </p>
      )}
      {factors.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">What moves the price</p>
          <ul className="mt-2 space-y-1.5">
            {factors.map((f) => (
              <li key={f.factor} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-slate-700">{f.description}</span>
                <span className={`shrink-0 font-semibold ${f.impact < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {f.impact < 0 ? "−" : "+"}
                  {formatUsd(Math.abs(f.impact))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
