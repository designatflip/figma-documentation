# Design Documentation

An internal, Mobbin-style catalogue of Flip's product screens, synced from a
dedicated Figma documentation project.

**Start with [SETUP.md](./SETUP.md)** — the code is complete, but nothing runs
until Figma and Vercel credentials are in place.

## How it works

```
Vercel Cron (nightly)  ─┐
Manual "Sync now"      ─┼─→ syncProject() ─→ Figma REST API
                        │        │             ├─ GET /v1/projects/:id/files   (discover + change gate)
                        │        │             └─ per changed flow file:
                        │        │                ├─ GET /v1/files/:key               (full tree)
                        │        │                ├─ GET /v1/files/:key/dev_resources (source links)
                        │        │                └─ GET /v1/images/:key?ids=…        (batch render)
                        │        │             └─ per distinct source file:
                        │        │                └─ GET /v1/files/:src/nodes?ids=…   (drift)
                        │        │
                        │        ├─→ walk tree → TEXT nodes → copy + bounding boxes
                        │        ├─→ download → sha256 → Vercel Blob (permanent CDN URL)
                        │        └─→ upsert Postgres → revalidateTag('catalog')
                        │
Clerk (proxy.ts) ─→ Next.js App Router ─→ reads Postgres + Blob only. Never calls Figma.
```

## The three constraints that shaped this

**Figma render URLs expire after 30 days.** So no Figma URL is ever persisted.
Images are downloaded and re-hosted on Blob; the database stores our URL plus
the `node_id` needed to re-render. A query asserting this is in SETUP.md step 4.

**File and image endpoints are Tier 1 rate-limited** (10–20 req/min by plan).
So Figma is never called at request time — this is a pre-render pipeline, and
the app only ever reads Postgres and the CDN. All Figma calls run through one
serial token bucket that honours `Retry-After`.

**Text search needs no OCR.** Unlike Mobbin, we have the source file, so every
`TEXT` node's `characters` is exact — including clipped, low-contrast, and
off-screen copy. Each node's `absoluteBoundingBox`, normalised 0–1 against its
frame, also drives the search highlight overlays in pure CSS.

## Publishing model

Figma is the sole source of truth. There is no publish state in the database
and no admin toggle.

- **Publish a flow** — add a file to the documentation project
- **Publish a screen** — duplicate a frame into one of those files
- **Unpublish** — remove it; `archived_at` is set, the row and image are kept
- **Descriptions** — come from Figma's `devStatus.description`

Sync is fully declarative: running it always converges the database to whatever
the project currently contains. A guardrail refuses any run that would archive
more than half a flow's live screens.

## Commands

```bash
npm run dev                          # dev server
npm run build                        # production build (needs no database)
npm run typecheck
npm run lint

npm run db:migrate                   # apply migrations
npm run db:studio                    # browse the data

npm run sync                         # sync from Figma
npm run sync -- --dry-run            # resolve everything, write nothing
npm run sync -- --check-token        # verify token scopes
npm run sync -- --force              # ignore the change gate
npm run sync -- --file <key>         # one flow file
npm run sync -- --allow-mass-archive # override the archive guardrail
npm run sync -- --skip-drift
```

## Layout

| Path | Purpose |
|---|---|
| `lib/figma/client.ts` | Rate-limited REST client, 429 backoff |
| `lib/figma/extract.ts` | Tree walking, text extraction, coordinate normalisation |
| `lib/figma/sync.ts` | The pipeline: discover → render → store → reconcile |
| `lib/figma/drift.ts` | Source comparison, batched per source file |
| `lib/queries.ts` | All reads. Owns the `archived_at IS NULL` guard |
| `db/schema.ts` | Drizzle schema, generated `tsvector` column |
| `proxy.ts` | Clerk auth (Next 16 renamed `middleware.ts` → `proxy.ts`) |

## Notes for future changes

- **Never set `use_absolute_bounds`** on the images call. It changes the render
  crop and silently invalidates every stored highlight coordinate.
- **The search config is `simple`, not `english`.** Postgres has no Indonesian
  dictionary and `english` stemming mangles Indonesian words. `pg_trgm` covers
  the resulting lack of stemming.
- **`archived_at IS NULL` belongs in `lib/queries.ts` only.** One missed
  `WHERE` leaks unpublished screens.
- **`connection()` before every catalog read** keeps `use cache` from being
  filled at build time, so deploys do not depend on the database.
