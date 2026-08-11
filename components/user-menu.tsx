"use client";

import { UserButton } from "@clerk/nextjs";

/**
 * The avatar and its menu.
 *
 * A client component on purpose: Clerk matches `UserButton`'s children against
 * its own component functions at runtime, and that check cannot see through a
 * server/client boundary — passed down from a Server Component, the menu items
 * are client references and Clerk warns that it ignored them.
 */
export function UserMenu() {
  return (
    <UserButton>
      {/* Admin used to sit in the bar itself, where the name is now. Everyone
          signed in may reach it — there is no admin role, only the domain
          check in lib/auth.ts. */}
      <UserButton.MenuItems>
        <UserButton.Link href="/admin" label="Admin" labelIcon={<AdminIcon />} />
      </UserButton.MenuItems>
    </UserButton>
  );
}

/** Sliders, to sit with Clerk's own icons in the menu. */
function AdminIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <path d="M2 4.5h8M13 4.5h1M2 11.5h1M6 11.5h8" />
      <circle cx="11.5" cy="4.5" r="1.75" />
      <circle cx="4.5" cy="11.5" r="1.75" />
    </svg>
  );
}
