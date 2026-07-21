# 🃏 Jackpot Joker

A weekly "find the Joker" card draw for a workplace charity / social club —
a public live-status display plus a secured admin dashboard to run the draw,
manage entrants, and track history.

**Stack:** vanilla HTML/CSS/JS (no build step) · Firebase Auth · Firebase
Firestore · deployed as a static site on Vercel.

---

## Contents

```
jackpot-joker/
├─ index.html                 Public display page
├─ admin/
│  └─ index.html               Admin dashboard (login-gated)
├─ css/
│  ├─ styles.css                Shared design system (tokens, cards, toasts…)
│  ├─ public.css                Public-page-only tweaks
│  └─ admin.css                 Admin-only layout (sidebar, tables, modals)
├─ js/
│  ├─ firebase-config.js        Firebase app/auth/db initialisation
│  ├─ auth.js                   Sign-in/out helpers
│  ├─ utils.js                  Secure randomness, toasts, CSV export, etc.
│  ├─ public.js                 Public page logic (realtime listeners)
│  └─ admin.js                  Admin dashboard logic (CRUD, draw flow…)
├─ scripts/
│  ├─ create-admin.js           Optional: provision admin accounts via CLI
│  ├─ package.json
├─ firestore.rules              Firestore security rules
├─ firestore.indexes.json
├─ firebase.json                Firebase CLI config (rules/indexes deploy only)
├─ .firebaserc                  Firebase project alias
├─ vercel.json                  Vercel static hosting config
├─ .env.example                 Env vars for the optional admin script only
└─ .gitignore
```

No framework, no bundler, no `npm install` needed to run the site itself —
Firebase's SDKs are imported straight from `gstatic.com` as ES modules.

---

## 1. Firebase setup

1. **Create/open your Firebase project.** You already have one —
   `jackpot-joker-3d398` — and its web config is already wired up in
   `js/firebase-config.js`. If you're starting fresh, create a project at
   <https://console.firebase.google.com>, add a **Web app**, and copy its
   config object into `js/firebase-config.js`.

   > This project uses **Cloud Firestore**, not the Realtime Database — if
   > your project also shows a `...firebaseio.com` Realtime Database URL,
   > you can ignore it; nothing in this app uses it.

2. **Enable Authentication.**
   Console → Build → Authentication → Sign-in method → enable **Email/Password**.

3. **Create Firestore.**
   Console → Build → Firestore Database → Create database → start in
   **production mode** (the rules in `firestore.rules` will lock it down
   properly — see below).

4. **Deploy the security rules.**
   ```bash
   npm install -g firebase-tools   # once
   firebase login
   firebase deploy --only firestore:rules,firestore:indexes
   ```
   (Or paste the contents of `firestore.rules` into Console → Firestore →
   Rules → publish, if you'd rather not install the CLI.)

5. **Create your first admin account.** Anyone who can sign in is treated as
   an admin (see "Security model" below), so only create accounts for
   trusted committee members. Easiest path — Console → Authentication →
   Users → **Add user**, enter an email + password. Alternatively use the
   bundled CLI helper:
   ```bash
   cd scripts
   npm install
   cp ../.env.example .env   # fill in a service-account key, see comments in the file
   node create-admin.js "you@company.com" "a-strong-password"
   ```

That's it on the Firebase side — **no manual Firestore documents need
creating**. The first time an admin signs in, `admin.js` automatically
bootstraps sensible default `settings/public` and `settings/private`
documents (£50 starting jackpot, 20-card deck, etc.) if they don't exist yet.
Adjust them from **Settings** afterwards.

---

## 2. Run it locally

Since it's a static site, any static file server works:

```bash
npx serve .
# or
python3 -m http.server 5173
```

Then open `http://localhost:5173` for the public page and
`http://localhost:5173/admin/` for the dashboard.

---

## 3. Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel: **Add New… → Project → Import** your GitHub repo.
3. Framework preset: **Other** (it's a static site — no build command,
   no output directory override needed; `vercel.json` handles headers).
4. Deploy. Your public page is at `https://<project>.vercel.app/` and the
   admin dashboard at `https://<project>.vercel.app/admin/`.
5. In Firebase Console → Authentication → Settings → **Authorized domains**,
   add your Vercel domain (and any custom domain) so sign-in works there.

No environment variables need setting in Vercel for the site itself — see
"Security model" for why the Firebase config can be committed safely.

---

## 4. How the weekly draw works

1. Admin opens **Run draw** and clicks **Select random winner** — this uses
   `crypto.getRandomValues()` (rejection-sampled, so there's no modulo bias)
   to pick one *active* entrant, **weighted by how many entries they bought**.
   Someone with 10 entries is 10× as likely to be picked as someone with 1 —
   see "Multiple entries" below.
2. The winner (in person, or over a call) is asked to choose any card that's
   still in the grid.
3. The admin taps that card on their behalf. The pick is resolved inside a
   **Firestore transaction** (`runDrawTransaction` in `js/admin.js`) so two
   admins can never race each other into an inconsistent state.
4. The card flips:
   - **Joker →** the pot (including this week's entry fees, added just
     before the outcome is decided) **splits 50/50**: the winner takes home
     half in cash, and the other half is added to a running
     **charity total**. The jackpot then resets to the starting value, every
     card returns to play, and a brand-new Joker position is generated with
     `crypto.getRandomValues()`.
   - **Standard card →** that card is permanently removed from the deck.
     This week's contribution — **total active entries × entry fee** — is
     added to the pot and it rolls over to next week. The pot grows in
     proportion to how many tickets are actually in play, not a flat top-up.
5. Every outcome is written to **`draws`** (full internal log, including the
   entry count/fee/contribution and, on a Joker win, the winner/charity
   split for that draw) and **`history`** (public-facing feed) in the same
   transaction, plus an **`auditLogs`** entry.

### Multiple entries ("buy 10, get 10× the chance")

Entrants only need a **name** — no email required. Each entrant also has an
**entries** count (defaults to 1) representing how many tickets they bought
that week:

- **Winner selection is weighted by entries.** `secureWeightedChoice()` in
  `js/utils.js` builds a cryptographically random pick across the *total*
  ticket pool, so an entrant with `entries: 10` has exactly 10× the chance
  of anyone with `entries: 1` — still zero `Math.random()`, just weighted.
- **The pot math uses total tickets, not headcount.** The "active entries"
  stat (both public page and admin Overview) and the entry-fee contribution
  each draw (`active entries × entry fee`) are based on the sum of
  everyone's `entries`, so someone buying 10 tickets contributes 10× the
  entry fee to the pot, exactly like 10 separate £1 entrants would.
- Set/change someone's entry count any time from Admin → Entrants → edit
  (✏️), or via bulk import: `Name, entries` per line (entries optional,
  defaults to 1) — e.g. `John Smith, 10`.

### Undoing a mistaken draw

Mistakes happen — the wrong card gets tapped, or the wrong person is
recorded as the winner. Admin → **Draw history** (or the Overview panel) has
an **↩ Undo last draw** button that reverses it: the jackpot, deck, secret
Joker position, and running charity total are restored to exactly how they
were the instant before that draw, and the corresponding public "previous
winners" entry is removed. The `draws` record itself is kept (marked `voided: true`) rather
than deleted, so there's a permanent trail of what happened and who undid it.

Two safety limits, both enforced in `js/admin.js`:
- **Only the single most recent draw can be undone.** Undoing an older draw
  would leave the deck/jackpot inconsistent with everything that happened
  after it, so the button is disabled for anything but the latest entry.
- **No re-do.** Once undone, that draw can't be undone again — you'd need to
  re-run the draw properly.
- If jackpot/deck settings were edited manually *after* the draw but before
  the undo, those manual edits are overwritten by the restore — the
  confirmation dialog warns about this before you commit.

---

## 5. Data model

| Collection         | Doc                | Fields |
|---------------------|--------------------|--------|
| `settings`           | `public`            | `jackpotAmount`, `startingJackpot`, `entryFee`, `totalCards`, `removedCards[]`, `nextDrawDate`, `gameStatus`, `activeEntrantsCount`, `totalRaisedForCharity` |
| `settings`           | `private`            | `jokerCardPosition` (never exposed publicly) |
| `entrants`            | `{id}`               | `name`, `entries`, `active`, `createdAt` |
| `draws`                | `{id}`               | `date`, `selectedWinner`, `selectedWinnerId`, `cardChosen`, `result`, `jackpotAmount`, `activeEntrants`, `entryFee`, `entryContribution`, `winnerPayout`, `charityAmount`, `previousState`, `historyDocId`, `voided`, `voidedAt`, `voidedBy` |
| `history`              | `{id}`               | `winner`, `date`, `cardChosen`, `jokerFound`, `jackpotAmount`, `winnerPayout`, `charityAmount` |
| `auditLogs`            | `{id}`               | `action`, `user`, `timestamp`, `details` |

`draws` and `history` are intentionally similar — `draws` is the detailed
internal log (admin-only, including the entry-fee maths and undo snapshot
for that draw), `history` is the trimmed, public-safe feed shown on the
display page as "Previous winners."

### Jackpot economics

The pot doesn't grow by a flat amount each week — it grows by
**active entrants × entry fee** (default £1/entrant), calculated live from
however many people are marked active at the moment the draw is run. That
contribution is added to the pot *before* the outcome is decided, so:

- A **Joker win** splits the pot 50/50: half pays out to the winner, half is
  added to the running `totalRaisedForCharity` figure (shown on both the
  public page and the admin Overview). The jackpot then resets to the
  starting value.
- A **standard card** rolls the jackpot (now including this week's entries)
  over to next week untouched.

Change the entry fee any time from Admin → Settings → "Entry fee per
entrant." The 50/50 split itself is fixed in `js/admin.js`
(`runDrawTransaction`) — search for `winnerPayout` if you ever need a
different ratio.

---

## 6. Security model

A few decisions worth knowing about if you extend this app:

- **Firebase web config isn't a secret.** `apiKey`, `appId` etc. identify
  *which* Firebase project a request is for — they don't grant access on
  their own. Real access control lives entirely in `firestore.rules` and
  Firebase Auth, so it's fine (and normal) to commit `firebase-config.js`.
- **The Joker's position is split into its own document** (`settings/private`)
  that only signed-in admins can read. If it lived in `settings/public`
  (which the display page reads), anyone could open dev tools and read the
  winning card before the draw. `settings/public` never contains it.
- **Entrant PII stays admin-only.** The public page never reads the
  `entrants` collection directly — it only shows an aggregate
  `activeEntrantsCount` maintained on `settings/public`.
- **"Signed in = admin."** This app has one permission tier: any account
  that can authenticate is trusted as an admin. Provision accounts
  carefully (Console → Authentication, or `scripts/create-admin.js`). If you
  need finer-grained roles later, add
  [custom claims](https://firebase.google.com/docs/auth/admin/custom-claims)
  and check them in `firestore.rules`.
- **No secrets ship to the browser.** The only credential-bearing code
  (`scripts/create-admin.js`, using a Firebase *Admin SDK* service account)
  never runs in the browser and is excluded from the deployed site.

---

## 7. Customising

- **Deck size / starting jackpot / entry fee** — Admin → Settings.
  Changing deck size reshuffles: all cards return to play and a fresh Joker
  position is generated. The entry fee controls how much each active
  entrant contributes to the pot per draw (see "Jackpot economics" above).
- **Colours, fonts, "Felt" vs "Parchment" themes** — CSS custom properties
  in `css/styles.css` (`:root` and `:root[data-theme="parchment"]`).
- **Card grid columns** — `.card-grid` in `css/styles.css` (defaults to 5,
  responsive down to 3 on small phones).

---

## 8. Accessibility & UX notes

- Respects `prefers-reduced-motion` (flip/shimmer/pulse animations are
  disabled) and `prefers-color-scheme` (defaults to the matching theme).
- All interactive controls are keyboard-reachable with visible focus rings.
- Destructive actions (remove entrant, reset jackpot, reshuffle deck, start
  new game) always go through the shared confirmation dialog.
- Toast notifications confirm every write so admins get feedback without
  a page reload.

---

## 9. Known limitations / next steps

- Single permission tier (any authenticated user is a full admin) — add
  custom claims if you need read-only or per-region admin roles.
- No email notifications to winners — could be added with a Cloud Function
  triggered on new `history` documents.
- CSV export happens client-side over whatever's currently loaded (capped at
  the last 200 draws) — fine for a weekly office draw, but raise the
  `limit()` in `js/admin.js` if your history grows very large.
