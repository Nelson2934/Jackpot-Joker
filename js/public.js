// js/public.js — Public Display Page
import { db } from "./firebase-config.js";
import {
  doc,
  onSnapshot,
  collection,
  query,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatGBP, formatDate, formatDateShort, showToast, escapeHTML } from "./utils.js";

/* ---------------------------------------------------------------------- *
 * THEME TOGGLE
 * ---------------------------------------------------------------------- */

const THEME_KEY = "jj-theme";
const root = document.documentElement;
const themeToggle = document.getElementById("themeToggle");
const themeIcon = document.getElementById("themeToggleIcon");
const themeLabel = document.getElementById("themeToggleLabel");

function applyTheme(theme) {
  root.setAttribute("data-theme", theme);
  const isParchment = theme === "parchment";
  themeIcon.textContent = isParchment ? "☀️" : "🌙";
  themeLabel.textContent = isParchment ? "Parchment" : "Felt";
  themeToggle.setAttribute("aria-pressed", String(isParchment));
}

const savedTheme = localStorage.getItem(THEME_KEY) ||
  (window.matchMedia("(prefers-color-scheme: light)").matches ? "parchment" : "felt");
applyTheme(savedTheme);

themeToggle.addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "felt" ? "parchment" : "felt";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

/* ---------------------------------------------------------------------- *
 * SETTINGS (public doc) → hero, stats, deck
 * ---------------------------------------------------------------------- */

const jackpotAmountEl = document.getElementById("jackpotAmount");
const jackpotSubEl = document.getElementById("jackpotSub");
const gameStatusEl = document.getElementById("gameStatus");
const gameStatusLabelEl = document.getElementById("gameStatusLabel");
const statActiveEntries = document.getElementById("statActiveEntries");
const statCardsRemaining = document.getElementById("statCardsRemaining");
const statNextDraw = document.getElementById("statNextDraw");
const statTotalCards = document.getElementById("statTotalCards");
const cardGrid = document.getElementById("cardGrid");

const SUITS = ["spade", "heart", "club", "diamond"];

let lastRemovedSignature = "";

function renderDeck(totalCards, removedCards) {
  const removedSet = new Set(removedCards || []);
  const signature = `${totalCards}:${[...removedSet].sort((a, b) => a - b).join(",")}`;
  if (signature === lastRemovedSignature && cardGrid.childElementCount === totalCards) {
    return; // avoid re-render/flicker if nothing actually changed
  }
  lastRemovedSignature = signature;

  cardGrid.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (let n = 1; n <= totalCards; n++) {
    const taken = removedSet.has(n);
    const slot = document.createElement("div");
    slot.className = "card-slot";
    slot.dataset.state = taken ? "taken" : "available";
    slot.style.animationDelay = `${Math.min(n * 12, 400)}ms`;

    const suit = SUITS[n % SUITS.length];

    slot.innerHTML = `
      <div class="card-slot__inner">
        <div class="card-face card-face--back">
          <span class="card-face__number">${n}</span>
          <span class="card-face__suit card-face__suit--${suit}" aria-hidden="true"></span>
        </div>
      </div>
    `;
    frag.appendChild(slot);
  }
  cardGrid.appendChild(frag);
}

onSnapshot(
  doc(db, "settings", "public"),
  (snap) => {
    if (!snap.exists()) {
      jackpotAmountEl.textContent = formatGBP(0);
      return;
    }
    const data = snap.data();

    jackpotAmountEl.textContent = formatGBP(data.jackpotAmount);
    statActiveEntries.textContent = data.activeEntrantsCount ?? "—";
    statTotalCards.textContent = data.totalCards ?? "—";

    const removed = data.removedCards || [];
    const remaining = Math.max((data.totalCards || 0) - removed.length, 0);
    statCardsRemaining.textContent = remaining;
    statNextDraw.textContent = data.nextDrawDate ? formatDate(data.nextDrawDate) : "TBC";

    const status = data.gameStatus || "active";
    gameStatusEl.classList.toggle("is-paused", status !== "active");
    gameStatusLabelEl.textContent =
      status === "active" ? "Game in play" : status === "paused" ? "Draw paused" : "Awaiting new game";

    const entryFee = data.entryFee ?? 1;
    jackpotSubEl.textContent =
      remaining <= 3 && remaining > 0
        ? `Only ${remaining} card${remaining === 1 ? "" : "s"} left — the odds are shortening!`
        : `Find the Joker among the cards to win the lot. £${entryFee.toFixed(2)} per entry rolls into the pot every week it isn't won.`;

    renderDeck(data.totalCards || 0, removed);
  },
  (err) => {
    console.error(err);
    showToast("Couldn't load live jackpot data.", "error");
  }
);

/* ---------------------------------------------------------------------- *
 * WINNER HISTORY (public collection)
 * ---------------------------------------------------------------------- */

const historyList = document.getElementById("historyList");
const winnersCount = document.getElementById("winnersCount");

const historyQuery = query(collection(db, "history"), orderBy("date", "desc"), limit(30));

onSnapshot(
  historyQuery,
  (snap) => {
    if (snap.empty) {
      historyList.innerHTML = `<div class="empty-state">No draws yet — check back after the first weekly draw.</div>`;
      winnersCount.textContent = "";
      return;
    }

    winnersCount.textContent = `${snap.size} draw${snap.size === 1 ? "" : "s"} on record`;

    historyList.innerHTML = "";
    const frag = document.createDocumentFragment();

    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const row = document.createElement("div");
      row.className = "history-row";
      row.innerHTML = `
        <div class="history-row__badge ${d.jokerFound ? "is-joker" : ""}">${
          d.jokerFound ? "🃏" : `#${d.cardChosen ?? "?"}`
        }</div>
        <div>
          <div class="history-row__name">${escapeHTML(d.winner || "Unknown")}</div>
          <div class="history-row__date">${formatDateShort(d.date)} · card ${escapeHTML(String(d.cardChosen ?? "—"))}${
            d.jokerFound ? " · JOKER" : ""
          }</div>
        </div>
        <div class="history-row__amount">${d.jokerFound ? formatGBP(d.jackpotAmount) : "rolled over"}</div>
        <div></div>
      `;
      frag.appendChild(row);
    });
    historyList.appendChild(frag);
  },
  (err) => {
    console.error(err);
    historyList.innerHTML = `<div class="empty-state">Couldn't load winner history.</div>`;
  }
);
