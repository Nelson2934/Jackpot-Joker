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
   to pick one *active* entrant.
2. The winner (in person, or over a call) is asked to choose any card that's
   still in the grid.
3. The admin taps that card on their behalf. The pick is resolved inside a
   **Firestore transaction** (`runDrawTransaction` in `js/admin.js`) so two
   admins can never race each other into an inconsistent state.
4. The card flips:
   - **Joker →** the winner takes the jackpot. The jackpot resets to the
     starting value, every card returns to play, and a brand-new Joker
     position is generated with `crypto.getRandomValues()`.
   - **Standard card →** that card is permanently removed from the deck,
     the jackpot rolls over (optionally topped up by the configured weekly
     increment), and the result is stored in history.
5. Every outcome is written to **`draws`** (full internal log) and
   **`history`** (public-facing feed) in the same transaction, plus an
   **`auditLogs`** entry.

---

## 5. Data model

| Collection         | Doc                | Fields |
|---------------------|--------------------|--------|
| `settings`           | `public`            | `jackpotAmount`, `startingJackpot`, `weeklyIncrement`, `totalCards`, `removedCards[]`, `nextDrawDate`, `gameStatus`, `activeEntrantsCount` |
| `settings`           | `private`            | `jokerCardPosition` (never exposed publicly) |
| `entrants`            | `{id}`               | `name`, `email`, `active`, `createdAt` |
| `draws`                | `{id}`               | `date`, `selectedWinner`, `selectedWinnerId`, `cardChosen`, `result`, `jackpotAmount` |
| `history`              | `{id}`               | `winner`, `date`, `cardChosen`, `jokerFound`, `jackpotAmount` |
| `auditLogs`            | `{id}`               | `action`, `user`, `timestamp`, `details` |

`draws` and `history` are intentionally similar — `draws` is the detailed
internal log (admin-only), `history` is the trimmed, public-safe feed shown
on the display page as "Previous winners."

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

- **Deck size / starting jackpot / weekly increment** — Admin → Settings.
  Changing deck size reshuffles: all cards return to play and a fresh Joker
  position is generated.
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
