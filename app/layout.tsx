import type { Metadata } from "next";
import { ClerkProvider, UserButton } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";

import { SearchInput } from "@/components/search-input";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Design Documentation",
  description: "Browsable catalogue of Flip's product screens, synced from Figma.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="flex min-h-full flex-col">
          <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-6 py-3">
              <Link href="/" className="text-sm font-semibold tracking-tight">
                Design Documentation
              </Link>
              {/* useSearchParams needs a Suspense boundary to keep the
                  surrounding shell statically prerenderable. */}
              <Suspense fallback={<div className="h-9 w-full max-w-md" />}>
                <SearchInput />
              </Suspense>
              <div className="ml-auto flex items-center gap-4 text-sm">
                <Link href="/admin" className="text-muted hover:text-foreground">
                  Admin
                </Link>
                {/* proxy.ts already requires a session on every non-public
                    route, so this only ever renders for a signed-in user. */}
                <UserButton />
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
            {children}
          </main>
        </body>
      </html>
    </ClerkProvider>
  );
}
