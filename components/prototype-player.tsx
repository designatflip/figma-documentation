import Link from "next/link";

import { PrototypeStage } from "@/components/prototype-stage";
import { figmaEmbedClientId } from "@/lib/env";
import { figmaEmbedUrl, figmaProtoUrl } from "@/lib/figma/extract";
import type { FlowPrototype } from "@/lib/queries";

export interface PrototypePlayerProps {
  flowName: string;
  flowSlug: string;
  /** The Figma file every starting point below lives in. */
  fileKey: string;
  /** Every starting point in the flow, in Figma's own order. */
  prototypes: FlowPrototype[];
  /** Node id of the one to play. Falls back to the first. */
  selectedNodeId?: string;
  /** Screens with nothing to tap — where the flow ends. */
  flowEndNodeIds: string[];
}

/** Used only until a screen has been rendered — phone-shaped is the safe guess. */
const FALLBACK_ASPECT = 9 / 16;

/**
 * Figma's own prototype player, embedded on a lightbox-style stage.
 *
 * Deliberately not a reimplementation. We could draw our own hotspots from the
 * `interactions` data — but that would be a second, quietly diverging renderer
 * of someone else's design, and it would silently lose smart animate, overlays,
 * scroll behaviour and video. Embedding means the prototype on this page is
 * the prototype, and it stays correct without us doing anything. The controls
 * in `PrototypeStage` follow the same rule: they command Figma's player rather
 * than stepping through screens themselves.
 *
 * The whole trick to it not looking like a postage stamp in a void is the
 * aspect-locked box: `scaling=contain` fits the frame inside whatever viewport
 * the iframe gives it, so a full-width iframe letterboxes a phone down to
 * nothing. Sizing the iframe to the frame's own ratio makes "contain" an exact
 * fit, and the phone then fills the stage's full height.
 *
 * The trade of embedding is that the iframe authenticates as the viewer:
 * someone without access to the Figma file sees Figma's request-access screen
 * inside the box. That is the same boundary the rest of the site assumes, and
 * it is why the link out sits on the stage rather than being the fallback of an
 * error state we cannot detect from outside the iframe.
 *
 * This half stays on the server so it can read the embed client id; everything
 * that touches the running prototype lives in the stage.
 */
export function PrototypePlayer({
  flowName,
  flowSlug,
  fileKey,
  prototypes,
  selectedNodeId,
  flowEndNodeIds,
}: PrototypePlayerProps) {
  const selected =
    prototypes.find((p) => p.nodeId === selectedNodeId) ?? prototypes[0];
  if (!selected) return null;

  // Built here rather than read off the cached row, so tuning the embed's
  // presentation parameters takes a reload instead of a re-sync.
  const clientId = figmaEmbedClientId();
  // Both forms are built up front. The stage drops to the plain one by itself
  // if Figma never opens the message channel, and making that swap in the
  // browser would otherwise mean shipping the URL builder — and the module of
  // sync internals it lives in — to the client.
  const controlledUrl = clientId
    ? figmaEmbedUrl(fileKey, selected.nodeId, { clientId })
    : null;
  const plainUrl = figmaEmbedUrl(fileKey, selected.nodeId);
  const protoUrl = figmaProtoUrl(fileKey, flowSlug, selected.nodeId);

  const { imageWidth, imageHeight } = selected.startsOn ?? {};
  // Both dimensions come from the same render, so the ratio is independent of
  // the scale it was rendered at.
  const aspect =
    imageWidth && imageHeight ? imageWidth / imageHeight : FALLBACK_ASPECT;

  return (
    <section>
      {/* A file usually has one starting point; the picker earns its space
          only when a designer pinned more than one. */}
      {prototypes.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {prototypes.map((prototype) => {
            const active = prototype.nodeId === selected.nodeId;
            return (
              <Link
                key={prototype.nodeId}
                href={`/flows/${flowSlug}?view=prototype&start=${encodeURIComponent(prototype.nodeId)}`}
                aria-current={active ? "true" : undefined}
                className={
                  "rounded-full border px-3 py-1.5 text-sm transition " +
                  (active
                    ? "border-accent text-foreground"
                    : "border-border text-muted hover:text-foreground")
                }
              >
                {prototype.name}
                {prototype.startsOn && (
                  <span className="ml-1.5 text-muted">
                    · {prototype.startsOn.name}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}

      <PrototypeStage
        // Switching starting point resets the stage's state along with the
        // iframe — a carried-over "has navigated" would light up Back on a
        // flow the viewer has not moved through yet.
        key={selected.nodeId}
        controlledUrl={controlledUrl}
        plainUrl={plainUrl}
        title={`${flowName} prototype`}
        aspect={aspect}
        startsOnLabel={selected.startsOn?.name}
        protoUrl={protoUrl}
        startNodeId={selected.nodeId}
        flowEndNodeIds={flowEndNodeIds}
      />

      <p className="mt-3 text-xs text-muted">
        Played straight from Figma, so it is always the current prototype.
        Requires access to the file.
      </p>
    </section>
  );
}
