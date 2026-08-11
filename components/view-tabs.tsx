import Link from "next/link";

/**
 * The Screens/Prototype switch.
 *
 * One control, two places: the screen page and the modal that intercepts it
 * both swap the render they are showing for the running prototype. Both are
 * the same promise to the viewer — "there is a playable version of this" — so
 * they are the same control rather than two that happen to look alike.
 */
export function ViewTabs({
  screensHref,
  prototypeHref,
  active,
  screensLabel = "Screens",
}: {
  screensHref: string;
  prototypeHref: string;
  active: "screens" | "prototype";
  /** "Screens" for a whole flow; the screen view calls its one render "Design". */
  screensLabel?: string;
}) {
  return (
    <div className="inline-flex shrink-0 gap-1 rounded-full bg-surface-muted p-1">
      <ViewTab href={screensHref} active={active === "screens"}>
        {screensLabel}
      </ViewTab>
      <ViewTab href={prototypeHref} active={active === "prototype"}>
        Prototype
      </ViewTab>
    </div>
  );
}

function ViewTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        "rounded-full px-3.5 py-1 text-sm font-medium transition " +
        (active
          ? "bg-surface-raised text-foreground shadow-sm"
          : "text-muted hover:text-foreground")
      }
    >
      {children}
    </Link>
  );
}
