# Setup

Everything in this file needs credentials or a Figma/Vercel account, so it has
to be done by a human. The application code is complete and builds without any
of it.

Work through it in order — step 4 verifies the riskiest part (the sync) before
you touch the UI.

---

## 1. Figma access

### The documentation project

Create a Figma **project** (folder) used only for documentation. Each **file**
inside it becomes a flow; the frames inside become screens.

```
Figma Project "Product Documentation"    ← FIGMA_PROJECT_ID
├── File "Top Up"                        → flow
│   ├── Page "Happy path"                → section
│   │   ├── Frame "Amount"               → screen
│   │   └── Frame "Method"               → screen
│   └── Page "Error states"              → section
└── File "_scratch"                      → skipped
```

Get the project id from the URL when the folder is open:
`figma.com/files/project/`**`1234567`**`/...`

### Token

Create a personal access token at **Figma → Settings → Security → Personal
access tokens** with exactly these three scopes — no others are used:

| Scope | Section in the token dialog | Used for |
|---|---|---|
| `projects:read` | Projects | Listing the files in the documentation project |
| `file_content:read` | Files | Reading each file's node tree and rendering PNGs |
| `file_dev_resources:read` | Development | Source links on each frame |

> `projects:read` fails loudly — discovery is the first call the sync makes, so
> a token without it 403s immediately.
>
> `file_dev_resources:read` fails *quietly*: sync completes, but every screen
> loses its source link and drift detection. `npm run sync -- --check-token`
> exists specifically to catch this.

Deliberately not needed: `file_metadata:read` (the `last_modified` change gate
reads it from the project and file payloads, not `/meta`), comments, versions,
and every library scope.

### Source links (optional but recommended)

For each documented frame, attach a **Dev Resource** in Dev Mode pointing at the
original frame in its feature file. That gives you the "View source design"
button and enables drift detection. Frames without one still sync fine.

---

## 2. Provision infrastructure

```bash
npx vercel login
npx vercel link

# Postgres
npx vercel integration add neon

# Clerk
npx vercel integration add clerk

# Blob store (public — images sit behind Clerk at the app layer)
npx vercel blob store add figma-docs

# Pull everything into .env.local
npx vercel env pull .env.local
```

Then add the values the integrations don't provide:

```bash
cp .env.example .env.local   # if you did not pull
# edit .env.local: FIGMA_ACCESS_TOKEN, FIGMA_PROJECT_ID, CRON_SECRET
openssl rand -hex 32         # for CRON_SECRET
```

Push the manual ones back up so the deployed app and cron have them:

```bash
npx vercel env add FIGMA_ACCESS_TOKEN production
npx vercel env add FIGMA_PROJECT_ID production
npx vercel env add CRON_SECRET production
```

### Clerk configuration

Two things in the Clerk dashboard:

1. **Restrictions → Allowlist** — add `flip.id` as an allowed email domain.
   This is the primary access control.
2. **Sessions → Customize session token** — add:
   ```json
   { "email": "{{user.primary_email_address}}" }
   ```
   `proxy.ts` uses this as a second check. It is deliberately fail-open: if the
   claim is missing the app does not lock everyone out, because the allowlist
   above is still enforcing the boundary. Configure both.

---

## 3. Database

```bash
npm run db:migrate
```

This applies two migrations:

- `0000_init` — tables, indexes, and the generated `search_vector` column
- `0001_pg_trgm` — the `pg_trgm` extension and trigram indexes

Confirm the generated column and extension landed:

```sql
\d screens
SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';
```

---

## 4. Verify the sync before building on it

```bash
npm run sync -- --check-token    # scopes, including file_dev_resources:read
npm run sync -- --dry-run        # resolves everything, writes nothing
```

The dry run prints the discovered flow/screen tree with extracted copy and
source links. Check against Figma that flows and frame counts match, and that
one frame's copy is complete and in reading order.

Then for real:

```bash
npm run sync
```

**Assert the 30-day expiry is actually handled** — no Figma URL may be stored:

```sql
SELECT count(*) FROM screens WHERE image_url NOT LIKE '%blob.vercel-storage.com%';
-- must be 0
```

**Re-run immediately.** The second run must skip every file at the change gate
(`flowsSkipped` equals `flowsChecked`). Then:

```bash
npm run sync -- --force
```

Hashes match, so `blobWrites` must be **0**. That proves re-syncing is cheap.

---

## 5. Publish lifecycle

Test all four transitions — this is the core contract of the whole system.

| # | Do this in Figma | Expect after `npm run sync` |
|---|---|---|
| 1 | Add a file to the project | Appears as a flow with its frames |
| 2 | Move the file out of the project | Flow + screens archived, gone from `/` and search |
| 3 | Move it back | `archived_at` clears, **0 blob writes**, original screen IDs |
| 4 | Rename a frame to `_old` | Only that screen archives |

Step 2 should **trip the mass-archive guardrail** and refuse. Confirm it does,
then re-run with `--allow-mass-archive`. A guardrail nobody has seen fire is not
a guardrail.

Also check: an archived screen's URL still renders read-only with a notice
rather than 404-ing.

---

## 6. Drift detection

```bash
npm run sync
```

- Edit a text label in a **source** frame only → that screen shows the drift
  badge on the next sync, with no prior history needed.
- Edit an **unrelated** frame elsewhere in the same source file → the screen
  must **not** be flagged. This is the whole reason drift scopes to
  `/nodes?ids=` instead of the source file's `last_modified`.
- Point a Dev Resource at a file the token cannot read → `drift_state` is
  `unknown`, logged, and the sync still succeeds.
- Confirm request count scales with distinct source *files*, not screens: 20
  screens from 2 source files should issue 2 drift requests.

---

## 7. Run it

```bash
npm run dev
```

- Signed out → redirected to Clerk. A non-`@flip.id` address → rejected.
- Search a phrase that appears **only inside** one screen's UI and nowhere in
  its name or description. It must return exactly that screen, and the
  highlight box must land on the right text at several browser widths.
- Search an Indonesian term with an affix (`pembayaran`) — it must not be
  mangled. This is why the search config is `simple`, not `english`.
- Search a typo or partial word — the `pg_trgm` fallback should still find it.
- `/admin` → "Sync now" after renaming a frame in Figma; the new name appears on
  `/` on the next render.

---

## 8. Deploy

```bash
npx vercel --prod
```

The nightly cron is declared in `vercel.json` (18:00 UTC = 01:00 WIB). Verify it
manually:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-deployment>/api/sync
# → JSON summary

curl -X POST https://<your-deployment>/api/sync
# → 401
```

---

## Known gaps

- **Tags** ship empty. `tags` / `screen_tags` exist but nothing populates them;
  Figma has no source for them. Descriptions come from `devStatus.description`.
- **Drift is detected, not repaired.** Re-duplicating a diverged frame is
  manual, deliberately — auto-refreshing would overwrite the editorial curation
  that is the point of the docs project.
- **No app-side kill switch.** Taking a screen down means removing it in Figma
  and syncing. This follows from Figma being the sole source of truth.
