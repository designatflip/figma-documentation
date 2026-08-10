import Image from "next/image";

export interface TextBox {
  content: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function matches(content: string, query: string): boolean {
  return content.toLowerCase().includes(query.toLowerCase());
}

/**
 * The screenshot, with optional highlight boxes over matching copy.
 *
 * Coordinates were normalised to 0–1 against the frame's bounding box at sync
 * time, so they position purely in percentages — correct at any rendered width
 * with no measurement, no ref, and no client JavaScript.
 */
export function ScreenImage({
  src,
  alt,
  width,
  height,
  texts = [],
  highlight,
  priority,
}: {
  src: string | null;
  alt: string;
  width: number | null;
  height: number | null;
  texts?: TextBox[];
  highlight?: string;
  priority?: boolean;
}) {
  if (!src) {
    return (
      <div className="flex aspect-[9/16] w-full items-center justify-center rounded-lg border border-border bg-surface-muted text-sm text-muted">
        No render available
      </div>
    );
  }

  const term = highlight?.trim();
  const boxes = term ? texts.filter((t) => matches(t.content, term)) : [];

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-surface-muted">
      <Image
        src={src}
        alt={alt}
        width={width ?? 800}
        height={height ?? 1600}
        className="h-auto w-full"
        priority={priority}
        sizes="(max-width: 1024px) 100vw, 60vw"
      />
      {boxes.map((box, index) => (
        <span
          key={`${box.x}-${box.y}-${index}`}
          aria-hidden
          className="pointer-events-none absolute rounded-[2px] bg-accent/25 ring-2 ring-accent"
          style={{
            left: `${box.x * 100}%`,
            top: `${box.y * 100}%`,
            width: `${box.w * 100}%`,
            height: `${box.h * 100}%`,
          }}
        />
      ))}
    </div>
  );
}
