import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";

import { SearchInput } from "@/components/search-input";
import { SignedInName } from "@/components/signed-in-name";
import { UserMenu } from "@/components/user-menu";
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

/**
 * `modal` is the slot in `app/@modal`: empty on a normal load, and filled by
 * the intercepted screen route when one is opened from a listing.
 */
export default function RootLayout({ children, modal }: LayoutProps<"/">) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="flex min-h-full flex-col">
          <header className="sticky top-0 z-10 bg-background/85 backdrop-blur py-2">
            {/* Three tracks so the search stays centred in the bar itself,
                rather than drifting with the width of what flanks it. */}
            <div className="mx-auto grid max-w-7xl grid-cols-[1fr_minmax(0,28rem)_1fr] items-center gap-4 px-6 py-3">
              <Link href="/" className="text-2xl font-semibold tracking-tight">
                Flip Design Hub
              </Link>
              {/* useSearchParams needs a Suspense boundary to keep the
                  surrounding shell statically prerenderable. */}
              {/* The fallback is the pill itself, empty: the header settles
                  into its final shape before the field arrives in it. */}
              <Suspense
                fallback={
                  <div className="h-10 w-full max-w-md rounded-full bg-surface-muted" />
                }
              >
                <SearchInput />
              </Suspense>
              <div className="flex items-center justify-end gap-4 text-sm">
                {/* Reads the session, so it streams in behind the avatar. */}
                <Suspense
                  fallback={
                    <div className="h-4 w-28 rounded-full bg-surface-muted" />
                  }
                >
                  <SignedInName />
                </Suspense>
                {/* proxy.ts already requires a session on every non-public
                    route, so this only ever renders for a signed-in user. */}
                <UserMenu />
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
            {children}
          </main>

          {modal}
        </body>
      </html>
    </ClerkProvider>
  );
}
