# Design Documentation — Case Study

An internal catalogue of Flip's product screens, published straight from Figma.

**Role:** Product Designer — problem framing, product definition, IA, interaction, copy
**Team:** Design (primary users), with PM, Engineering, Ops, Support, and Content as secondary users
**Status:** Shipped internally

---

## 1. Background

### How design work happens at Flip

Flip's design team ships payment flows: top-up, transfer, verification,
disbursement. Every one of them is a chain of ten to thirty screens, most of
which are states nobody sees on a good day — insufficient balance, expired
session, rejected KYC, partial failure.

The team's day looks like this: a designer picks up a feature, opens Figma,
and starts by asking what already exists. That question is asked several times
a week, by almost everyone, and it has never had a reliable answer.

### What we already had

| Asset | What it gives us | What it doesn't |
|---|---|---|
| A Figma component library | Consistent buttons, inputs, tokens | No view of finished flows — parts, not outcomes |
| Hundreds of Figma files | Everything we ever designed, stored forever | No way to tell shipped from abandoned |
| The production app | The real current experience | Only the states you can actually reach |
| Slack history | Screenshots people once shared | Unsearchable, undated, unlinked |

We were rich in artefacts and poor in *answers*. The company had scaled past
the point where any one person held the whole product in their head, and the
tools we had all assumed someone still did.

### The reference point everyone already used

The team browses **Mobbin** constantly — to see how other fintechs handle a
flow, to sanity-check a pattern, to build a mood. Everyone understood the value
instantly: a grid of real screens, grouped into real flows, searchable.

We had that for every product in the world except our own.

### The trigger — three problems we actually had

**① Marketing kept requesting Figma documentation.**
Requests arrived regularly from outside the design team — marketing wanting
current screens for campaigns and collateral, and other teams wanting to see a
flow. Every one of them was routed to a designer, who stopped their work,
hunted through files, and exported images by hand. The request was completely
reasonable. The fulfilment was a person, every time, and it never got faster
because nothing was left behind afterwards.

**② The documentation we had was bad.**
Not missing — *bad*, which is worse. Partial flows, missing states, no dates,
no link back to the design, no way to tell what was still true. It looked
authoritative enough that people used it, and wrong often enough that they
eventually stopped. Every previous attempt failed the same way: built with
enthusiasm, maintained for a month, then quietly abandoned while still sitting
there looking official.

**③ Figma itself was outdated, and nobody could find the newest flow.**
The deepest problem. Files accumulate iterations; the newest version of a flow
might be in the original feature file, or a duplicate someone made for a
handoff, or a page named `v3 final`. Opening a file gave no reliable signal of
whether you were looking at what ships today. So people either asked a person,
or — the expensive failure — designed against a version that was already dead.

Those three are one problem seen from three sides: **there is no place where
the current design is definitively current.** Marketing has to ask because
there's nowhere to look. Documentation goes bad because it's a copy that
nothing keeps honest. Figma feels outdated because it holds every version at
once with no marker for which one counts.

---

## 2. The problem & objective

### Problem statement

> Flip has no single place where the current design is definitively current.
> Figma holds every version of every flow with nothing marking which one ships,
> the documentation we've written goes stale without saying so, and anyone
> outside the design team — marketing, PM, support — has to interrupt a designer
> to see their own product. So the same knowledge gets re-found by hand on every
> request, and work sometimes starts from a version that's already dead.

### What I heard and observed

I talked to designers, PMs, and support, and watched people actually perform a
lookup while I timed it. Five findings shaped everything after.

**① Nobody wants one screen — they want the neighbourhood.**
Every real request was comparative or sequential: *"how do we word errors like
this?"*, *"what comes before this screen?"*, *"show me everywhere we ask for a
PIN."* A single screenshot is almost never the answer.

**② People search for words they saw, not names we gave.**
Every observed search used product copy — a button label, an error string, a
phrase from the UI. Nobody searched by layer name or internal feature name,
because the internal name isn't what's on the screen.

**③ Figma search can't answer the question — and neither can opening the file.**
Figma matches file and layer names, not the copy inside a design. A search
across team files returns forty results — explorations, rejected variants, a
redesign that never shipped — with nothing marking which one is live. Even
opening the right file doesn't settle it: which page is current, `v2` or
`v3 final`? The answer lives in a person's memory, not in the file.

**④ Trust dies with staleness, and staleness is invisible.**
The first question about any documented screen was *"is this still true?"*.
Documentation that goes quietly stale is worse than none: people trust it for a
quarter, get burned once, and stop trusting anything. This is exactly how our
existing documentation became bad.

**⑤ Nobody has time to maintain it.**
Everyone who'd curate this is fully booked shipping product. Every past attempt
— a "source of truth" Figma file, a Notion page of screenshots — died the same
way: maintained for a month, sporadically for another, then never.

**⑥ Every request outside the design team lands on a designer.**
Marketing needs current screens for a campaign; support needs to see a state a
customer described; a PM needs a flow for a spec. None of them can self-serve,
so all of it becomes design team interrupt work — and none of that work
accumulates into anything reusable.

### The cost of leaving it alone

| Symptom | What it costs |
|---|---|
| No definitive "current" version | Work starts against a dead version; rework found late |
| Marketing and other teams must ask | Recurring interrupts on designers; nothing left behind after each one |
| Existing documentation is unreliable | Trusted once, wrong once, abandoned — and it still looks official |
| Prior art is unfindable | Designers redesign what exists; patterns fork silently |
| Copy is uninspectable | Several wordings of the same error, with no way to audit consistency |
| Context is lost on handover | Every new joiner rebuilds the same mental map |

### Objectives

**Primary objective**
Give anyone at Flip a way to see and search our product's current design in
under a minute — without a Figma seat, without asking a person, and without
anyone being assigned to maintain it.

**Supporting objectives**

| # | Objective | Why it matters |
|---|---|---|
| O1 | One place that is definitively current, with no version guessing | Problem ③ — the root cause behind all three |
| O2 | Non-designers self-serve screens without asking a designer | Problem ① — marketing and support stop being interrupt work |
| O3 | Make publishing cost a designer nothing extra | Problem ② / finding ⑤ — anything with upkeep has a half-life |
| O4 | Make the copy inside screens searchable | Finding ② — this is how people actually look |
| O5 | Make freshness visible instead of assumed | Finding ④ — trust is the product |
| O6 | Make links permanent | So documentation can be cited in PRDs, tickets, and threads |

### Design principles

Written before any screen, and used to kill features later.

1. **Publishing must be a by-product of finishing, never a second job.**
2. **The flow is the unit, not the screen.** Context ships with every result.
3. **Report facts, never verdicts.** The system can observe; the designer judges.
4. **Assume zero maintenance budget.** If a feature needs tidying, cut it.
5. **Win by letting people leave.** This is a lookup tool, not a place to linger.

That last one is a real departure from Mobbin. Mobbin succeeds when you stay
and browse; we succeed when you get your answer and close the tab. Same card
grid, opposite success metric — and it removed collections, likes, feeds, and
recommendations from scope in one stroke.

### The core insight

The failure mode of every internal documentation tool is **the publish step**.
Not the storage, not the search — the moment where a human has to stop doing
their work and go tell a system about it.

So the objective became sharper:

> **Remove the publish step entirely.** Documenting a flow should be something
> designers already do at the end of a project, not something added to it.

And it solves problem ③ as a side effect. The reason nobody can find the newest
flow is that "newest" is a claim someone has to make and maintain. If the
catalogue only ever contains what's deliberately placed in one folder, then
being in the catalogue *is* the claim — and it stays true without anyone
renaming a page `v4 final`.

---

## 3. What we will build

### The concept in one line

**An internal Mobbin for Flip, published by putting a Figma file in a folder.**

### The publishing model — the single most important decision

There is **no publish button**. There is no draft state, no review queue, no
admin toggle, no second place to keep tidy. Every lifecycle action is something
a designer does in Figma:

| To do this | You do this |
|---|---|
| Publish a flow | Add a file to the Figma documentation project |
| Publish a screen | Duplicate a finished frame into one of those files |
| Unpublish | Take it out of the project |
| Describe a screen | Write in Dev Mode's description field |
| Order the screens | Arrange the frames — their order is the order |

The structure maps one-to-one onto objects designers already use:

```
Figma project "Product Documentation"
├── File  "Top Up"              → a FLOW
│   ├── Page  "Happy path"      → a SECTION
│   │   ├── Frame "Amount"      → a SCREEN
│   │   └── Frame "Method"      → a SCREEN
│   └── Page  "Error states"    → a SECTION
└── File  "_scratch"            → ignored (leading underscore)
```

Four nouns. Nothing asks a designer to learn a fifth, and there is never a
question of which system is right — Figma is the only one that can be.

**Alternatives considered and rejected:**

| Option | Why not |
|---|---|
| Admin UI with a publish toggle | Two sources of truth that eventually disagree |
| `#docs` naming convention on frames | Scatters the decision across every file; "what's documented?" becomes unanswerable |
| Review/approval step before publishing | Correct for a 40-person design org; here it's a queue nobody owns |
| A Notion page of screenshots | Dead pixels — no link back, no way to know if it's current |

### What we're building, by objective

**① Browse — flows first**
The home surface is flows, not screens: a grid of cover cards, one per
documented flow, with a screen count. Open one and you get every screen in the
designer's own order, grouped by section. This is finding ① made structural —
you always land in a neighbourhood, never on an orphan.

**② Search — on the words people actually saw**
Search covers screen names, descriptions, **and every word of copy inside the
screen** — including copy that's clipped, low-contrast, or off-canvas, because
we're reading the design file rather than looking at a picture of it.

Results are screenshots with the matched text **boxed on the image itself**,
and the highlight follows you into the detail view. If the match is inside the
picture, the answer has to be inside the picture too.

Search works across Indonesian and English equally — real product copy is both,
often in the same screen — and tolerates typos and partial words.

**③ Screen detail — the answer plus its context**
One screen, full size, with everything needed to act on it: which flow and
section it belongs to, its description, and one-click routes into Figma
(design view and dev view). Breadcrumbs are always present, because most people
arrive here from a search or a pasted link rather than by navigating.

**④ Freshness — stated, not assumed**
Two mechanisms, both designed around principle #3:

- **"Last synced"** is shown on the surface rather than buried, so nobody has
  to guess how current the catalogue is.
- **Change flags** — when a documented screen is linked back to the live design
  it was copied from, the system compares them and reports differences as
  *"Source copy differs"* or *"Source design has changed"* — sitting right
  beside a link to that source, so the response is one click.

Never *"Outdated."* Never a red dot. We can prove the source changed; we can't
know the documentation is wrong — the designer may have documented that variant
deliberately. A badge that overclaims gets ignored within two weeks, and an
ignored warning devalues every other warning in the product.

**⑤ Permanence — links that outlive the design**
Unpublishing archives rather than deletes. The screen leaves browsing and
search immediately, but its link still opens, showing the screenshot read-only
with a dated note explaining it was removed. The reason anyone opens a
six-month-old link is that someone cited it in a decision — a 404 destroys the
context that made it worth clicking. It also makes unpublishing *safe*, which
is what keeps people willing to do it.

**⑥ Access — one rule, so anyone can self-serve**
On the company domain, you're in. No roles, no per-flow permissions, no
viewer/editor split, no Figma seat required. This is deliberate and it is the
answer to problem ① — marketing, support, and PMs get the same view designers
get, so the request that used to be a DM becomes a link they find themselves.
Anyone outside the domain gets a plain page explaining this is internal — not
an error code, not a redirect loop.

### Surfaces

| Surface | Job |
|---|---|
| **Flows** | See everything documented, at a glance |
| **Flow** | See one journey end to end, in the designer's order |
| **Screen** | Get the answer, plus context and a route into Figma |
| **Search** | Find by the words you remember seeing |
| **Sync status** | Know the catalogue is healthy; refresh it on demand |

Five surfaces, deliberately. Every proposed sixth was cut.

### Explicitly out of scope

| Not building | Why |
|---|---|
| Comments and annotations | Figma has them, attached to the design itself |
| Collections, favourites, feeds | We're a lookup tool — principle #5 |
| A tag management UI | A taxonomy is maintenance; nobody has asked twice |
| Per-screen version history | Figma owns version history |
| A publish button | The entire point |
| A mobile-specific experience | Everyone doing this work is at a desk with Figma open |

### Teaching the model

The publishing rule is simple but unexpected — every other documentation tool
has a publish button. So it's explained at the three moments people actually
wonder about it, rather than in an onboarding doc nobody reads:

- **Empty home state:** "Add a file to the Figma documentation project…"
- **No search results:** "Search covers documented screens only. Check that its
  file is in the Figma documentation project."
- **Sync status header:** "Publishing is controlled entirely in Figma — there is
  no publish toggle here by design."

Anyone who opens the admin page is looking for a publish button. Telling them
the rule at the exact moment they look for it beats any amount of documentation
about the documentation tool.

---

## 4. Success metrics

<!-- Targets below are proposals. Replace with agreed numbers, and fill in
     results once you have a month of real usage. -->

### The one that matters

> **Does anyone still have to ask a designer to see the product?**

Everything else is a proxy. If marketing still DMs a designer for screens, and
designers still ask each other which version is current, the tool failed no
matter how good the search is.

### Primary metrics

| # | Metric | How we measure it | Target |
|---|---|---|---|
| M1 | Requests to designers for screens/documentation | Count inbound asks from marketing, PM, support — monthly | Down [X]% in 2 months; most fulfilled with a link |
| M2 | Time to find the current version of a flow | Timed task with 5 people, before vs. after | Under 60 seconds, from several minutes |
| M3 | "Which one is the newest?" questions | Count in design channels | Approaching zero for documented flows |
| M4 | Documented flows | Count in the catalogue | Growing monthly with nobody being nagged |
| M5 | Non-designer usage | Share of active users outside the design team | Over 40% — proves it serves more than the team that built it |

M1 is the metric I'd report to leadership: it's the one that converts to hours
of design time returned. M4 is the metric I'd watch privately — it's the real
test of the publishing model. If flows stop being added the moment I stop
reminding people, the "publishing is free" claim was wrong and needs
re-solving, not re-promoting.

### Secondary metrics

| # | Metric | Why we watch it | Target |
|---|---|---|---|
| M6 | Zero-result search rate | Failed searches are a free list of what people expect to exist | Under 20%, and falling |
| M7 | Catalogue links cited in PRDs/tickets/threads | Citation is the strongest possible trust signal | Appearing at all within a month |
| M8 | Flagged screens resolved vs. ignored | Tests whether the change flags are believed | Most flags actioned, not aged out |
| M9 | New-joiner ramp | Ask each new designer whether they used it in week one | Used unprompted |
| M10 | Rework traced to an outdated reference | Retro question: did anyone design against a dead version? | Zero for documented flows |

M6 is the highest-value thing to instrument next. A list of searches that
returned nothing is a prioritised backlog of what to document, written by the
people who need it.

### Guardrail metrics — what would tell us it's going wrong

| Signal | What it would mean |
|---|---|
| Change flags ignored for weeks | We overclaimed; the warning has been trained-ignored |
| Publishing only happens when I ask | Publishing isn't actually free — objective O3 failed |
| People screenshot *from* the catalogue into Slack | Sharing a link isn't working; check permissions and load speed |
| Search used, then Figma searched anyway | Results aren't trusted or aren't complete enough |
| Marketing asks a designer *and* the flow is documented | The catalogue exists but they don't know or don't trust it — a rollout problem, not a product one |

### Qualitative check — one month in

Five conversations — including at least one person outside design — five
questions:

1. When did you last need to see an existing screen? What did you do?
2. Did you have to ask anyone? If yes, why wasn't the catalogue enough?
3. Was anything you expected to be here missing?
4. Did you trust what you saw was current? How did you decide?
5. Have you published anything? Did you think about it, or did it just happen?

Question 5 is the one I care about. The right answer isn't "yes, it was easy" —
it's *"I don't remember publishing anything, but the flow is in there."* That's
what a by-product feels like from the inside.

### What we deliberately don't measure

- **Time on site.** Longer is worse. We win when people leave with an answer.
- **Page views.** A person browsing for ten minutes probably didn't find it.
- **Screens documented.** Volume without use is a well-organised graveyard.

---

## Where this goes next

Ranked by expected value, not effort:

1. **Log zero-result searches** — the cheapest way to learn what's missing.
2. **Copy-to-clipboard on screen text** — writers and engineers currently retype
   strings we already hold.
3. **"Where else does this copy appear?"** — we know every string and where it
   sits in every screen. *"We word this three different ways"* is a finding this
   data is uniquely able to produce, and it turns a copy audit from a project
   into a query.
4. **Derived tags, never authored ones** — inferred from Figma structure, so
   nobody curates a taxonomy.
5. **Alert on sync failure** — a broken refresh is currently visible only to
   whoever looks at a page that's usually fine.

---

## The transferable lesson

Not the search, and not the change detection:

> **Find out what the maintenance budget really is before you design the
> interface.** If it's zero, that's a constraint as hard as a screen size — and
> most documentation designs quietly assume it isn't.

Everything good here came from taking a zero maintenance budget literally: no
publish button, no curation, no tagging, no review queue, descriptions pulled
from a field designers already fill in. Everything I cut was something that
assumed a person would keep it tidy.
