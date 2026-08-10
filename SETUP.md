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

# Blob store — each upload is written with access: "public"
# (lib/figma/sync.ts); images sit behind Clerk at the app layer
npx vercel blob create-store figma-docs

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

**The domain allowlist is not available on the free plan.** Clerk gates
Restrictions → Allowlist behind a paid plan on *production* instances (it is
free on development instances, so you will see it work locally and then hit
"Plan upgrade required" for production). The access boundary therefore lives in
`lib/auth.ts`, not in the dashboard — `proxy.ts`, the admin Server Action, and
the webhook below all call the same rule.

Three things in the Clerk dashboard:

1. **Sessions → Customize session token** — add:
   ```json
   { "email": "{{user.primary_email_address}}" }
   ```
   **Required.** `proxy.ts` fails *closed* on this claim: a session without it
   is refused, and the reason is logged. This is the access control — if you
   skip this step nobody can sign in, which is the intended failure direction
   now that no dashboard restriction is backing it up.

2. **Restrictions → Enable restricted mode** — free, and it stops strangers
   creating accounts at all: sign-ups are disabled, and people get in only by
   invitation, manual creation, or enterprise SSO. Invite the team from
   **Users → Invite**. Without this, anyone can create an account; they just
   land on `/not-authorized` instead of the docs.

   Note this gates account *creation*, not sign-in. Anyone who signed up before
   you enabled it keeps their account — `proxy.ts` blocks them, but delete them
   under Users if you want them gone.

3. **Webhooks → Add endpoint** — `https://<your-domain>/api/webhooks/clerk`,
   subscribed to **`user.created`** only. Copy the endpoint's signing secret
   into `CLERK_WEBHOOK_SIGNING_SECRET`:

   ```bash
   npx vercel env add CLERK_WEBHOOK_SIGNING_SECRET production
   ```

   The handler deletes any account created outside the allowed domain. This is
   the second lock behind restricted mode, and it is what keeps the Clerk user
   list equal to the set of people who can actually sign in. Development and
   production endpoints have **different** secrets.

   To exercise it locally:

   ```bash
   clerk webhooks listen --token "$(clerk webhooks token)" \
     --forward-to http://localhost:3000/api/webhooks/clerk
   ```

   Add the printed relay URL as an endpoint in the dashboard — events do not
   flow until you do. Then create a user on a non-`flip.id` address and confirm
   it disappears from **Users** within a few seconds.

If you later move to a paid plan, add `flip.id` to Restrictions → Allowlist as
well. Nothing in the code changes — the checks become defence in depth rather
than the boundary.

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

## 8. Publish from inside Figma

`figma-plugin/` is a private Figma plugin that publishes **the file you have
open**, so a designer never has to leave Figma or open `/admin`. It triggers the
same `syncProject` as everything else, scoped with `onlyFileKey`.

### Install

Figma → Plugins → Development → **Import plugin from manifest…** → pick
`figma-plugin/manifest.json`.

Before installing for anyone else, set `allowedDomains` in that manifest to your
real deployment. A domain that is not listed is blocked by Figma *before* the
request leaves the browser, which surfaces as an unexplained network error with
nothing in your server logs.

The plugin needs `figma.fileKey`, which is readable only by private plugins —
hence `"enablePrivatePluginApi": true`. That flag also covers a locally imported
development plugin, so the import above works today. **Publishing it org-wide
needs a Figma plan that allows private plugins**; check with whoever administers
the Figma organisation. Failing that, each designer imports the manifest once.

### Connect

Publishing runs as a person, not as a shared robot: `CRON_SECRET` must never
ship inside a plugin bundle, since anyone who can run the plugin can read it.

Press **Connect**. The plugin opens `/plugin/pair` in a browser, which sits
behind Clerk like every other page — so pairing is exactly as restricted as the
site, `@flip.id` included. Confirming there mints a token bound to that Clerk
user; the plugin collects it once and keeps it in `figma.clientStorage`.

The pairing code is single-use, expires in five minutes, and only the plugin
instance that generated it can redeem it.

### Revoke

`/admin` → **Figma plugins** lists everyone connected, with a Revoke button.
Revocation applies on the next publish. Nothing needs revoking when someone
leaves, though — `authenticateSyncRequest` re-checks the email domain on every
call, so losing the Clerk account is enough.

### Check it works

- Open a file **in** the documentation project → Publish → a summary appears
  within seconds and the screen updates on `/`.
- Publish again → `0 image write(s)`. Re-publishing is meant to be cheap.
- Open a file **outside** the project → it must say so plainly rather than
  report a successful publish of nothing.
- Revoke your own token, then Publish → the plugin drops the dead token and
  offers Connect again.

### One sync at a time

Every trigger — cron, `/admin`, `npm run sync`, the plugin — takes a lease in
`sync_locks` first, and a second caller gets a 409 rather than a duplicate run
burning Figma quota. The lease is renewed while a run works and expires on its
own after a crash, so nothing stays stuck.

---

## 9. Deploy

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

Both checks return the Vercel SSO redirect, not `200`/`401`, if **Deployment
Protection** is on. Standard Protection exempts custom production domains only —
a `*.vercel.app` project alias is not one — so it must be off until step 10
lands a real domain. Settings → Deployment Protection → Vercel Authentication.

---

## 10. Outstanding: move production off the Clerk development instance

**Production currently serves `figma-documentation-red.vercel.app` on Clerk
`pk_test_`/`sk_test_` keys** (instance `well-snipe-77`). Everything works, but
development instances carry strict usage limits and are not meant for real
traffic. This section is the remaining work, blocked only on DNS.

Neither plan is the constraint: Clerk's free tier includes custom domains and
production instances (50,000 MRU/app), and the Vercel team is on Pro. Clerk
requires a domain *you own* on every plan, which is why the `.vercel.app` alias
cannot be used. `flip.id` resolves via **Cloudflare** nameservers, so every
record below is added there, not in Vercel.

1. **Pick a subdomain** — e.g. `design-docs.flip.id`.

2. **Vercel** — add it to the project. Vercel issues a CNAME target
   (`cname.vercel-dns.com`).

3. **Clerk** — create the Production instance on that same subdomain. Its
   Domains page issues a `clerk.` CNAME, an accounts CNAME, and DKIM/mail
   records if you use Clerk-sent email.

4. **Cloudflare** — add all of the above as **DNS only (grey cloud)**. Proxying
   breaks Vercel certificate issuance *and* Clerk certificate deployment. This
   is the failure people hit; it looks like a propagation delay and never
   resolves.

5. **Clerk → Deploy certificates.** Up to 48h to propagate, usually minutes.

6. **Sessions → Customize session token on the Production instance** — add
   `{ "email": "{{user.primary_email_address}}" }`. Per-instance config, and
   `proxy.ts` fails closed without it, so skipping this locks everyone out.
   See §2, step 1.

7. **Swap the keys and re-point the webhook:**

   ```bash
   npx vercel env rm  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY production
   npx vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY production   # pk_live_…
   npx vercel env rm  CLERK_SECRET_KEY production
   npx vercel env add CLERK_SECRET_KEY production                    # sk_live_…
   ```

   Register the `user.created` endpoint on the Production instance at
   `https://design-docs.flip.id/api/webhooks/clerk` and replace
   `CLERK_WEBHOOK_SIGNING_SECRET` — development and production endpoints have
   **different** secrets. Then `npx vercel --prod`; env changes need a redeploy.

8. **Re-enable Standard Protection.** The custom domain stays public, deployment
   URLs go back behind SSO.

9. **Re-run the §9 curl checks** against the new domain.

Consider also setting `ALLOWED_EMAIL_DOMAIN` explicitly in production. It
defaults to `flip.id` in `lib/env.ts`, so behaviour is correct today, but this
value *is* the access boundary and should not be left to a default.

---

## Known gaps

- **Tags** ship empty. `tags` / `screen_tags` exist but nothing populates them;
  Figma has no source for them. Descriptions come from `devStatus.description`.
- **Drift is detected, not repaired.** Re-duplicating a diverged frame is
  manual, deliberately — auto-refreshing would overwrite the editorial curation
  that is the point of the docs project.
- **No app-side kill switch.** Taking a screen down means removing it in Figma
  and syncing. This follows from Figma being the sole source of truth.
