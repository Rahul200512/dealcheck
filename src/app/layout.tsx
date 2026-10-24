import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://dealcheck-two.vercel.app";
const shareTitle = "DealCheck — Is this used car a good deal?";
const shareDescription =
  "Paste a used-car listing and get a fair-price estimate, a deal rating and what moves the price, from models trained on 11,746 cleaned listings.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: shareTitle, template: "%s · DealCheck" },
  description:
    "End-to-end machine learning project: data cleaning, Linear Regression vs Random Forest vs Gradient Boosting, a validated prediction API and a web interface to estimate used car prices.",
  openGraph: { type: "website", siteName: "DealCheck", title: shareTitle, description: shareDescription, url: "/" },
  twitter: { card: "summary_large_image", title: shareTitle, description: shareDescription },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <SiteHeader />
        {children}
        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p>
              <span className="font-semibold text-slate-700">DealCheck</span> — used car price estimates and deal checks.
            </p>
            <p>Estimates are statistical predictions from a simulated marketplace dataset, not financial advice.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
