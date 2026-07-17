// js/admin.js — Admin Dashboard
import { db, auth } from "./firebase-config.js";
import { login, logout, watchAuth, resetPassword, describeAuthError } from "./auth.js";
import {
  secureRandomInt,
  secureRandomChoice,
  formatGBP,
  formatDate,
  formatDateShort,
  showToast,
  confirmAction,
  exportToCSV,
  escapeHTML,
  debounce,
} from "./utils.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
  runTransaction,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const SETTINGS_PUBLIC_REF = doc(db, "settings", "public");
const SETTINGS_PRIVATE_REF = doc(db, "settings", "private");

/* ========================================================================
 * AUTH GUARD + LOGIN
 * ===================================================================== */

const loginView = document.getElementById("loginView");
const dashboardView = document.getElementById("dashboardView");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const loginSubmit = document.getElementById("loginSubmit");
const loginSubmitLabel = document.getElementById("loginSubmitLabel");
const sidebarUser = document.getElementById("sidebarUser");

let currentUser = null;
let unsubscribers = []; // realtime listeners, torn down on logout

watchAuth((user) => {
  currentUser = user;
  if (user) {
    loginView.classList.add("hidden");
    dashboardView.classList.remove("hidden");
    sidebarUser.textContent = user.email;
    initDashboardData();
  } else {
    loginView.classList.remove("hidden");
    dashboardView.classList.add("hidden");
    unsubscribers.forEach((fn) => fn());
    unsubscribers = [];
  }
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  loginError.textContent = "";
  loginSubmit.disabled = true;
  loginSubmitLabel.innerHTML = `<span class="spinner"></span> Signing in…`;
  try {
    const cred = await login(email, password);
    await logAudit("Login", cred.user.email);
    showToast(`Welcome back, ${cred.user.email}`, "success");
  } catch (err) {
    loginError.textContent = describeAuthError(err);
  } finally {
    loginSubmit.disabled = false;
    loginSubmitLabel.textContent = "Sign in";
  }
});

document.getElementById("forgotPasswordBtn").addEventListener("click", async () => {
  const email = document.getElementById("loginEmail").value.trim();
  if (!email) {
    loginError.textContent = "Enter your email above first, then tap forgot password.";
    return;
  }
  try {
    await resetPassword(email);
    showToast("Password reset email sent.", "success");
  } catch (err) {
    loginError.textContent = describeAuthError(err);
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  const user = auth.currentUser;
  await logout();
  if (user) await logAudit("Logout", user.email);
  showToast("Signed out.", "info");
});

/* ========================================================================
 * THEME TOGGLE (shared pattern with public page)
 * ===================================================================== */

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
}
applyTheme(localStorage.getItem(THEME_KEY) || "felt");
themeToggle.addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "felt" ? "parchment" : "felt";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

/* ========================================================================
 * SIDEBAR NAVIGATION
 * ===================================================================== */

const navLinks = document.querySelectorAll(".nav-link");
const panels = document.querySelectorAll(".panel");

function showPanel(panelId) {
  panels.forEach((p) => p.classList.toggle("is-active", p.id === panelId));
  navLinks.forEach((l) => l.classList.toggle("is-active", l.dataset.panel === panelId));
}
navLinks.forEach((link) => link.addEventListener("click", () => showPanel(link.dataset.panel)));
document.querySelectorAll("[data-goto]").forEach((btn) =>
  btn.addEventListener("click", () => showPanel(btn.dataset.goto))
);

/* ========================================================================
 * AUDIT LOG
 * ===================================================================== */

async function logAudit(action, userLabel, details = "") {
  try {
    await addDoc(collection(db, "auditLogs"), {
      action,
      user: userLabel || auth.currentUser?.email || "unknown",
      timestamp: serverTimestamp(),
      details,
    });
  } catch (err) {
    console.error("Audit log failed:", err);
  }
}

/* ========================================================================
 * DASHBOARD DATA BOOTSTRAP
 * Wires up all realtime listeners. Called once per sign-in.
 * ===================================================================== */

let latestPublicSettings = null;

function initDashboardData() {
  watchSettings();
  watchEntrants();
  watchDrawHistory();
  watchAuditLog();
}

/* ========================================================================
 * SETTINGS (overview stats + settings panel prefill)
 * ===================================================================== */

const ovJackpot = document.getElementById("ovJackpot");
const ovEntrants = document.getElementById("ovEntrants");
const ovCardsRemaining = document.getElementById("ovCardsRemaining");
const ovNextDraw = document.getElementById("ovNextDraw");

const settingCurrentJackpot = document.getElementById("settingCurrentJackpot");
const settingStartingJackpot = document.getElementById("settingStartingJackpot");
const settingWeeklyIncrement = document.getElementById("settingWeeklyIncrement");
const settingTotalCards = document.getElementById("settingTotalCards");
const settingNextDraw = document.getElementById("settingNextDraw");
const settingGameStatus = document.getElementById("settingGameStatus");

let settingsFormDirty = false;
[settingCurrentJackpot, settingStartingJackpot, settingWeeklyIncrement, settingTotalCards, settingNextDraw, settingGameStatus]
  .forEach((el) => el.addEventListener("input", () => (settingsFormDirty = true)));

async function bootstrapSettingsIfMissing() {
  const [pubSnap, privSnap] = await Promise.all([getDoc(SETTINGS_PUBLIC_REF), getDoc(SETTINGS_PRIVATE_REF)]);
  if (!pubSnap.exists()) {
    const totalCards = 20;
    await setDoc(SETTINGS_PUBLIC_REF, {
      jackpotAmount: 50,
      startingJackpot: 50,
      weeklyIncrement: 10,
      totalCards,
      removedCards: [],
      nextDrawDate: null,
      gameStatus: "active",
      activeEntrantsCount: 0,
    });
    if (!privSnap.exists()) {
      await setDoc(SETTINGS_PRIVATE_REF, { jokerCardPosition: secureRandomInt(totalCards) + 1 });
    }
    await logAudit("Settings changed", null, "First-run defaults created automatically");
    showToast("Set up a fresh game with default settings — adjust them any time.", "info", 6000);
  } else if (!privSnap.exists()) {
    // Public settings exist but private doc is missing — repair it.
    const totalCards = pubSnap.data().totalCards || 20;
    await setDoc(SETTINGS_PRIVATE_REF, { jokerCardPosition: secureRandomInt(totalCards) + 1 });
  }
}

function watchSettings() {
  bootstrapSettingsIfMissing().catch((err) => console.error("Bootstrap failed:", err));
  const unsub = onSnapshot(SETTINGS_PUBLIC_REF, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    latestPublicSettings = data;

    ovJackpot.textContent = formatGBP(data.jackpotAmount);
    ovCardsRemaining.textContent = Math.max((data.totalCards || 0) - (data.removedCards || []).length, 0);
    ovNextDraw.textContent = data.nextDrawDate ? formatDate(data.nextDrawDate) : "TBC";

    if (!settingsFormDirty) {
      settingCurrentJackpot.value = data.jackpotAmount ?? 0;
      settingStartingJackpot.value = data.startingJackpot ?? 0;
      settingWeeklyIncrement.value = data.weeklyIncrement ?? 0;
      settingTotalCards.value = data.totalCards ?? 20;
      settingGameStatus.value = data.gameStatus || "active";
      if (data.nextDrawDate) {
        const d = data.nextDrawDate?.toDate ? data.nextDrawDate.toDate() : new Date(data.nextDrawDate);
        if (!Number.isNaN(d.getTime())) settingNextDraw.value = d.toISOString().slice(0, 10);
      }
    }

    renderDrawCardGrid(data);
  });
  unsubscribers.push(unsub);
}

/* ---- Save jackpot settings ---- */
document.getElementById("saveJackpotBtn").addEventListener("click", async () => {
  const current = Number(settingCurrentJackpot.value);
  const starting = Number(settingStartingJackpot.value);
  const weekly = Number(settingWeeklyIncrement.value);
  if ([current, starting, weekly].some((n) => Number.isNaN(n) || n < 0)) {
    showToast("Enter valid, non-negative amounts.", "error");
    return;
  }
  await updateDoc(SETTINGS_PUBLIC_REF, {
    jackpotAmount: current,
    startingJackpot: starting,
    weeklyIncrement: weekly,
  });
  settingsFormDirty = false;
  await logAudit("Jackpot changed", null, `Set current=${formatGBP(current)}, starting=${formatGBP(starting)}, weekly=${formatGBP(weekly)}`);
  showToast("Jackpot settings saved.", "success");
});

document.getElementById("increaseJackpotBtn").addEventListener("click", async () => {
  const raw = prompt("Top-up amount to add to the current jackpot (£):", "10");
  if (raw === null) return;
  const amount = Number(raw);
  if (Number.isNaN(amount) || amount <= 0) {
    showToast("Enter a positive amount.", "error");
    return;
  }
  const newAmount = (latestPublicSettings?.jackpotAmount || 0) + amount;
  await updateDoc(SETTINGS_PUBLIC_REF, { jackpotAmount: newAmount });
  settingCurrentJackpot.value = newAmount;
  await logAudit("Jackpot changed", null, `Top-up of ${formatGBP(amount)} added (new total ${formatGBP(newAmount)})`);
  showToast(`Added ${formatGBP(amount)} to the jackpot.`, "success");
});

document.getElementById("resetJackpotBtn").addEventListener("click", async () => {
  const ok = await confirmAction({
    title: "Reset jackpot?",
    message: "The current jackpot will be set back to the starting value. This cannot be undone.",
    confirmLabel: "Reset jackpot",
  });
  if (!ok) return;
  const starting = latestPublicSettings?.startingJackpot ?? 0;
  await updateDoc(SETTINGS_PUBLIC_REF, { jackpotAmount: starting });
  settingCurrentJackpot.value = starting;
  await logAudit("Jackpot changed", null, `Manually reset to starting value ${formatGBP(starting)}`);
  showToast("Jackpot reset to starting value.", "success");
});

/* ---- Save deck size (reshuffles) ---- */
document.getElementById("saveDeckBtn").addEventListener("click", async () => {
  const totalCards = Number(settingTotalCards.value);
  if (!Number.isInteger(totalCards) || totalCards < 2 || totalCards > 200) {
    showToast("Deck size must be a whole number between 2 and 200.", "error");
    return;
  }
  const ok = await confirmAction({
    title: "Reshuffle the deck?",
    message: `The deck will be resized to ${totalCards} cards. All cards return to play and a new hidden Joker position is generated.`,
    confirmLabel: "Reshuffle deck",
  });
  if (!ok) return;

  const newJokerPos = secureRandomInt(totalCards) + 1;
  await updateDoc(SETTINGS_PUBLIC_REF, { totalCards, removedCards: [] });
  await setDoc(SETTINGS_PRIVATE_REF, { jokerCardPosition: newJokerPos }, { merge: true });
  await logAudit("Deck reset", null, `Deck resized to ${totalCards} cards, new Joker position generated`);
  showToast("Deck saved and reshuffled.", "success");
});

/* ---- Schedule & status ---- */
document.getElementById("saveScheduleBtn").addEventListener("click", async () => {
  const dateVal = settingNextDraw.value;
  const status = settingGameStatus.value;
  await updateDoc(SETTINGS_PUBLIC_REF, {
    nextDrawDate: dateVal ? Timestamp.fromDate(new Date(`${dateVal}T00:00:00`)) : null,
    gameStatus: status,
  });
  settingsFormDirty = false;
  await logAudit("Settings changed", null, `Next draw=${dateVal || "unset"}, status=${status}`);
  showToast("Schedule saved.", "success");
});

/* ---- Start new game ---- */
document.getElementById("startNewGameBtn").addEventListener("click", async () => {
  const ok = await confirmAction({
    title: "Start a brand new game?",
    message: "This resets the deck, restores the starting jackpot and clears removed cards. Draw history is preserved.",
    confirmLabel: "Start new game",
  });
  if (!ok) return;

  const totalCards = latestPublicSettings?.totalCards || 20;
  const starting = latestPublicSettings?.startingJackpot ?? 0;
  const newJokerPos = secureRandomInt(totalCards) + 1;

  await updateDoc(SETTINGS_PUBLIC_REF, {
    jackpotAmount: starting,
    removedCards: [],
    gameStatus: "active",
  });
  await setDoc(SETTINGS_PRIVATE_REF, { jokerCardPosition: newJokerPos }, { merge: true });
  await logAudit("Deck reset", null, "New game started: deck cleared, jackpot restored to starting value");
  showToast("New game started!", "success");
});

/* ========================================================================
 * ENTRANTS
 * ===================================================================== */

const entrantsTbody = document.getElementById("entrantsTbody");
const entrantCountLabel = document.getElementById("entrantCountLabel");
const entrantSearch = document.getElementById("entrantSearch");
let allEntrants = [];

function watchEntrants() {
  const unsub = onSnapshot(collection(db, "entrants"), (snap) => {
    allEntrants = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    allEntrants.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    renderEntrantsTable();
    syncActiveEntrantsCount();
    ovEntrants.textContent = allEntrants.filter((e) => e.active).length;
  });
  unsubscribers.push(unsub);
}

function renderEntrantsTable() {
  const term = entrantSearch.value.trim().toLowerCase();
  const filtered = allEntrants.filter(
    (e) => !term || e.name?.toLowerCase().includes(term) || e.email?.toLowerCase().includes(term)
  );
  entrantCountLabel.textContent = `${filtered.length} of ${allEntrants.length} entrants`;

  if (filtered.length === 0) {
    entrantsTbody.innerHTML = `<tr><td colspan="5" class="text-muted">No entrants match your search.</td></tr>`;
    return;
  }

  entrantsTbody.innerHTML = filtered
    .map(
      (e) => `
      <tr data-id="${e.id}">
        <td>${escapeHTML(e.name || "—")}</td>
        <td class="text-muted">${escapeHTML(e.email || "—")}</td>
        <td><span class="badge ${e.active ? "badge--active" : "badge--inactive"}">${e.active ? "Active" : "Inactive"}</span></td>
        <td class="text-muted">${e.createdAt ? formatDateShort(e.createdAt) : "—"}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" data-action="edit" title="Edit">✏️</button>
            <button class="icon-btn" data-action="toggle" title="Toggle active">${e.active ? "⏸" : "▶️"}</button>
            <button class="icon-btn icon-btn--danger" data-action="delete" title="Remove">🗑️</button>
          </div>
        </td>
      </tr>`
    )
    .join("");
}

entrantSearch.addEventListener("input", debounce(renderEntrantsTable, 150));

entrantsTbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const row = btn.closest("tr");
  const id = row.dataset.id;
  const entrant = allEntrants.find((x) => x.id === id);
  if (!entrant) return;

  if (btn.dataset.action === "edit") {
    openEntrantModal(entrant);
  } else if (btn.dataset.action === "toggle") {
    await updateDoc(doc(db, "entrants", id), { active: !entrant.active });
    await logAudit("Entrant edited", null, `${entrant.name} set to ${!entrant.active ? "active" : "inactive"}`);
    showToast(`${entrant.name} is now ${!entrant.active ? "active" : "inactive"}.`, "success");
  } else if (btn.dataset.action === "delete") {
    const ok = await confirmAction({
      title: "Remove entrant?",
      message: `${entrant.name} will be permanently removed from the entrant list.`,
      confirmLabel: "Remove entrant",
    });
    if (!ok) return;
    await deleteDoc(doc(db, "entrants", id));
    await logAudit("Entrant removed", null, entrant.name);
    showToast(`${entrant.name} removed.`, "success");
  }
});

async function syncActiveEntrantsCount() {
  const activeCount = allEntrants.filter((e) => e.active).length;
  if (latestPublicSettings && latestPublicSettings.activeEntrantsCount === activeCount) return;
  try {
    await updateDoc(SETTINGS_PUBLIC_REF, { activeEntrantsCount: activeCount });
  } catch (err) {
    console.error("Failed to sync active entrant count:", err);
  }
}

/* ---- Add / edit entrant modal ---- */

const entrantModal = document.getElementById("entrantModal");
const entrantForm = document.getElementById("entrantForm");
const entrantModalTitle = document.getElementById("entrantModalTitle");

function openEntrantModal(entrant = null) {
  document.getElementById("entrantId").value = entrant?.id || "";
  document.getElementById("entrantName").value = entrant?.name || "";
  document.getElementById("entrantEmail").value = entrant?.email || "";
  document.getElementById("entrantActive").checked = entrant ? !!entrant.active : true;
  entrantModalTitle.textContent = entrant ? "Edit entrant" : "Add entrant";
  entrantModal.classList.add("is-open");
  entrantModal.setAttribute("aria-hidden", "false");
  document.getElementById("entrantName").focus();
}
function closeEntrantModal() {
  entrantModal.classList.remove("is-open");
  entrantModal.setAttribute("aria-hidden", "true");
}

document.getElementById("addEntrantOpenBtn").addEventListener("click", () => openEntrantModal());
document.getElementById("entrantModalCancel").addEventListener("click", closeEntrantModal);
entrantModal.addEventListener("click", (e) => { if (e.target === entrantModal) closeEntrantModal(); });

entrantForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("entrantId").value;
  const name = document.getElementById("entrantName").value.trim();
  const email = document.getElementById("entrantEmail").value.trim();
  const active = document.getElementById("entrantActive").checked;
  if (!name || !email) return;

  const saveBtn = document.getElementById("entrantModalSave");
  saveBtn.disabled = true;
  try {
    if (id) {
      await updateDoc(doc(db, "entrants", id), { name, email, active });
      await logAudit("Entrant edited", null, name);
      showToast("Entrant updated.", "success");
    } else {
      await addDoc(collection(db, "entrants"), { name, email, active, createdAt: serverTimestamp() });
      await logAudit("Entrant added", null, name);
      showToast("Entrant added.", "success");
    }
    closeEntrantModal();
  } catch (err) {
    console.error(err);
    showToast("Couldn't save entrant.", "error");
  } finally {
    saveBtn.disabled = false;
  }
});

/* ---- Bulk import ---- */

const bulkImportModal = document.getElementById("bulkImportModal");
document.getElementById("bulkImportOpenBtn").addEventListener("click", () => {
  document.getElementById("bulkImportText").value = "";
  bulkImportModal.classList.add("is-open");
  bulkImportModal.setAttribute("aria-hidden", "false");
});
document.getElementById("bulkImportCancel").addEventListener("click", () => {
  bulkImportModal.classList.remove("is-open");
  bulkImportModal.setAttribute("aria-hidden", "true");
});
bulkImportModal.addEventListener("click", (e) => {
  if (e.target === bulkImportModal) {
    bulkImportModal.classList.remove("is-open");
    bulkImportModal.setAttribute("aria-hidden", "true");
  }
});

document.getElementById("bulkImportSubmit").addEventListener("click", async () => {
  const raw = document.getElementById("bulkImportText").value;
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    showToast("Paste at least one entrant line first.", "error");
    return;
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const parsed = [];
  const rejected = [];
  for (const line of lines) {
    const [namePart, emailPart] = line.split(",").map((s) => s?.trim());
    if (!namePart || !emailPart || !emailRe.test(emailPart)) {
      rejected.push(line);
      continue;
    }
    parsed.push({ name: namePart, email: emailPart });
  }

  if (parsed.length === 0) {
    showToast("No valid rows found. Use: Name, email@company.com", "error");
    return;
  }

  const btn = document.getElementById("bulkImportSubmit");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Importing…`;
  try {
    await Promise.all(
      parsed.map((p) =>
        addDoc(collection(db, "entrants"), { name: p.name, email: p.email, active: true, createdAt: serverTimestamp() })
      )
    );
    await logAudit("Entrant added", null, `Bulk import of ${parsed.length} entrant(s)`);
    showToast(
      `Imported ${parsed.length} entrant${parsed.length === 1 ? "" : "s"}.` +
        (rejected.length ? ` ${rejected.length} line(s) skipped (bad format).` : ""),
      rejected.length ? "warning" : "success"
    );
    bulkImportModal.classList.remove("is-open");
    bulkImportModal.setAttribute("aria-hidden", "true");
  } catch (err) {
    console.error(err);
    showToast("Bulk import failed partway through.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Import entrants";
  }
});

/* ========================================================================
 * DRAW FLOW
 * ===================================================================== */

const selectWinnerBtn = document.getElementById("selectWinnerBtn");
const winnerReveal = document.getElementById("winnerReveal");
const winnerName = document.getElementById("winnerName");
const winnerNameInline = document.getElementById("winnerNameInline");
const drawStep2 = document.getElementById("drawStep2");
const drawStep3 = document.getElementById("drawStep3");
const drawCardGrid = document.getElementById("drawCardGrid");
const drawResultPanel = document.getElementById("drawResultPanel");
const newDrawBtn = document.getElementById("newDrawBtn");

let currentWinnerEntrant = null;
let drawInProgress = false;

selectWinnerBtn.addEventListener("click", async () => {
  const active = allEntrants.filter((e) => e.active);
  if (active.length === 0) {
    showToast("No active entrants to draw from. Add or activate entrants first.", "error");
    return;
  }
  if ((latestPublicSettings?.removedCards || []).length >= (latestPublicSettings?.totalCards || 0)) {
    showToast("No cards remain in the deck. Start a new game first.", "error");
    return;
  }

  selectWinnerBtn.disabled = true;
  selectWinnerBtn.innerHTML = `<span class="spinner"></span> Drawing…`;

  // Small suspense delay purely for UX theatre — the random pick itself is instant.
  await new Promise((r) => setTimeout(r, 550));

  currentWinnerEntrant = secureRandomChoice(active);
  winnerName.textContent = currentWinnerEntrant.name;
  winnerNameInline.textContent = currentWinnerEntrant.name;
  winnerReveal.hidden = false;
  drawStep2.hidden = false;
  drawStep3.hidden = true;
  drawResultPanel.innerHTML = "";
  drawInProgress = true;

  renderDrawCardGrid(latestPublicSettings);
  selectWinnerBtn.disabled = false;
  selectWinnerBtn.textContent = "🎲 Select random winner";
  drawStep2.scrollIntoView({ behavior: "smooth", block: "start" });
});

function renderDrawCardGrid(settingsData) {
  if (!settingsData || !drawInProgress) {
    drawCardGrid.innerHTML = "";
    return;
  }
  const totalCards = settingsData.totalCards || 0;
  const removed = new Set(settingsData.removedCards || []);
  drawCardGrid.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (let n = 1; n <= totalCards; n++) {
    const taken = removed.has(n);
    const slot = document.createElement("div");
    slot.className = `card-slot ${!taken ? "is-pickable" : ""}`;
    slot.dataset.state = taken ? "taken" : "available";
    slot.dataset.cardNumber = n;
    slot.innerHTML = `
      <div class="card-slot__inner">
        <div class="card-face card-face--back">
          <button class="card-hit" type="button" ${taken ? "disabled" : ""} aria-label="Pick card ${n}"></button>
          <span class="card-face__number">${n}</span>
        </div>
        <div class="card-face card-face--front" aria-hidden="true">
          <span class="card-face__number">${n}</span>
        </div>
      </div>`;
    frag.appendChild(slot);
  }
  drawCardGrid.appendChild(frag);
}

drawCardGrid.addEventListener("click", async (e) => {
  const button = e.target.closest("button.card-hit:not(:disabled)");
  if (!button || !drawInProgress) return;
  const slot = button.closest(".card-slot");
  const cardNumber = Number(slot.dataset.cardNumber);
  await revealCard(cardNumber, slot);
});

async function revealCard(cardNumber, slotEl) {
  drawInProgress = false;
  drawCardGrid.querySelectorAll(".card-hit").forEach((b) => (b.disabled = true));

  try {
    const result = await runDrawTransaction(cardNumber, currentWinnerEntrant);

    // Flip animation
    slotEl.classList.add("is-flipped");
    const frontFace = slotEl.querySelector(".card-face--front");
    if (result.jokerFound) {
      frontFace.classList.add("is-joker");
      frontFace.innerHTML = `<span class="card-face__label">JOKER</span><span class="card-face__number">🃏</span>`;
      slotEl.classList.add("is-joker-reveal");
    }

    setTimeout(() => {
      drawStep3.hidden = false;
      if (result.jokerFound) {
        drawResultPanel.innerHTML = `
          <div class="draw-result draw-result--joker">
            <div class="draw-result__title">🃏 JACKPOT WON!</div>
            <div class="draw-result__sub">${escapeHTML(currentWinnerEntrant.name)} found the Joker on card ${cardNumber} and takes home ${formatGBP(result.wonAmount)}!</div>
          </div>`;
        showToast(`${currentWinnerEntrant.name} won the jackpot! 🎉`, "success", 6000);
      } else {
        drawResultPanel.innerHTML = `
          <div class="draw-result draw-result--standard">
            <div class="draw-result__title">Card ${cardNumber} — no Joker this week</div>
            <div class="draw-result__sub">The jackpot rolls over to ${formatGBP(result.newJackpot)} for next week's draw.</div>
          </div>`;
        showToast(`Card ${cardNumber} was a standard card. Jackpot rolls over.`, "info", 5000);
      }
      drawStep3.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 750);
  } catch (err) {
    console.error(err);
    showToast(err.message || "Draw failed — please try again.", "error");
    drawInProgress = true;
    drawCardGrid.querySelectorAll(".card-hit:not([disabled])").forEach((b) => (b.disabled = false));
  }
}

/**
 * Runs the whole "card chosen" outcome as a single Firestore transaction so
 * two admins can never both resolve a card pick against stale settings data.
 */
async function runDrawTransaction(cardNumber, winnerEntrant) {
  return runTransaction(db, async (tx) => {
    const publicSnap = await tx.get(SETTINGS_PUBLIC_REF);
    const privateSnap = await tx.get(SETTINGS_PRIVATE_REF);
    if (!publicSnap.exists() || !privateSnap.exists()) {
      throw new Error("Game settings are missing. Check the Settings panel.");
    }
    const pub = publicSnap.data();
    const priv = privateSnap.data();
    const removed = new Set(pub.removedCards || []);
    if (removed.has(cardNumber)) {
      throw new Error("That card has already been drawn — pick another.");
    }

    const jokerFound = Number(priv.jokerCardPosition) === Number(cardNumber);
    const drawDate = serverTimestamp();
    const jackpotAtDraw = pub.jackpotAmount || 0;

    let newJackpot;
    let newRemoved;
    let newJokerPos = priv.jokerCardPosition;

    if (jokerFound) {
      newJackpot = pub.startingJackpot ?? 0;
      newRemoved = [];
      newJokerPos = secureRandomInt(pub.totalCards || 20) + 1;
      tx.update(SETTINGS_PUBLIC_REF, {
        jackpotAmount: newJackpot,
        removedCards: newRemoved,
        gameStatus: "active",
      });
      tx.set(SETTINGS_PRIVATE_REF, { jokerCardPosition: newJokerPos }, { merge: true });
    } else {
      newRemoved = [...removed, cardNumber];
      newJackpot = jackpotAtDraw + (pub.weeklyIncrement || 0);
      tx.update(SETTINGS_PUBLIC_REF, {
        removedCards: newRemoved,
        jackpotAmount: newJackpot,
      });
    }

    const drawRef = doc(collection(db, "draws"));
    tx.set(drawRef, {
      date: drawDate,
      selectedWinner: winnerEntrant.name,
      selectedWinnerId: winnerEntrant.id,
      cardChosen: cardNumber,
      result: jokerFound ? "joker" : "standard",
      jackpotAmount: jackpotAtDraw,
    });

    const historyRef = doc(collection(db, "history"));
    tx.set(historyRef, {
      winner: winnerEntrant.name,
      date: drawDate,
      cardChosen: cardNumber,
      jokerFound,
      jackpotAmount: jokerFound ? jackpotAtDraw : newJackpot,
    });

    const auditRef = doc(collection(db, "auditLogs"));
    tx.set(auditRef, {
      action: "Winner selected",
      user: auth.currentUser?.email || "unknown",
      timestamp: drawDate,
      details: `${winnerEntrant.name} chose card ${cardNumber} — ${jokerFound ? "JOKER" : "standard"}`,
    });

    return { jokerFound, wonAmount: jackpotAtDraw, newJackpot };
  });
}

newDrawBtn.addEventListener("click", () => {
  winnerReveal.hidden = true;
  drawStep2.hidden = true;
  drawStep3.hidden = true;
  drawCardGrid.innerHTML = "";
  currentWinnerEntrant = null;
  drawInProgress = false;
});

/* ========================================================================
 * DRAW HISTORY PANEL + CSV EXPORT
 * ===================================================================== */

const drawHistoryTbody = document.getElementById("drawHistoryTbody");
const ovRecentDraws = document.getElementById("ovRecentDraws");
let allDraws = [];

function watchDrawHistory() {
  const q = query(collection(db, "draws"), orderBy("date", "desc"), limit(200));
  const unsub = onSnapshot(q, (snap) => {
    allDraws = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderDrawHistoryTable();
    renderRecentDraws();
  });
  unsubscribers.push(unsub);
}

function renderDrawHistoryTable() {
  if (allDraws.length === 0) {
    drawHistoryTbody.innerHTML = `<tr><td colspan="5" class="text-muted">No draws recorded yet.</td></tr>`;
    return;
  }
  drawHistoryTbody.innerHTML = allDraws
    .map(
      (d) => `
      <tr>
        <td class="text-muted">${formatDateShort(d.date)}</td>
        <td>${escapeHTML(d.selectedWinner || "—")}</td>
        <td>#${escapeHTML(String(d.cardChosen ?? "—"))}</td>
        <td><span class="badge ${d.result === "joker" ? "badge--joker" : "badge--standard"}">${d.result === "joker" ? "🃏 Joker" : "Standard"}</span></td>
        <td>${formatGBP(d.jackpotAmount)}</td>
      </tr>`
    )
    .join("");
}

function renderRecentDraws() {
  const recent = allDraws.slice(0, 5);
  if (recent.length === 0) {
    ovRecentDraws.innerHTML = `<div class="empty-state">No draws yet.</div>`;
    return;
  }
  ovRecentDraws.innerHTML = recent
    .map(
      (d) => `
      <div class="history-row">
        <div class="history-row__badge ${d.result === "joker" ? "is-joker" : ""}">${d.result === "joker" ? "🃏" : `#${d.cardChosen}`}</div>
        <div>
          <div class="history-row__name">${escapeHTML(d.selectedWinner || "—")}</div>
          <div class="history-row__date">${formatDateShort(d.date)}</div>
        </div>
        <div class="history-row__amount">${formatGBP(d.jackpotAmount)}</div>
        <div></div>
      </div>`
    )
    .join("");
}

document.getElementById("exportCsvBtn").addEventListener("click", () => {
  if (allDraws.length === 0) {
    showToast("No draw history to export yet.", "warning");
    return;
  }
  const rows = allDraws.map((d) => [
    formatDateShort(d.date),
    d.selectedWinner || "",
    d.cardChosen ?? "",
    d.result || "",
    (d.jackpotAmount ?? 0).toFixed(2),
  ]);
  exportToCSV("jackpot-joker-draw-history.csv", rows, ["Date", "Winner", "Card", "Result", "Jackpot (GBP)"]);
  showToast("Draw history exported.", "success");
});

/* ========================================================================
 * AUDIT LOG PANEL
 * ===================================================================== */

const auditTbody = document.getElementById("auditTbody");

function watchAuditLog() {
  const q = query(collection(db, "auditLogs"), orderBy("timestamp", "desc"), limit(200));
  const unsub = onSnapshot(q, (snap) => {
    if (snap.empty) {
      auditTbody.innerHTML = `<tr><td colspan="4" class="text-muted">No audit entries yet.</td></tr>`;
      return;
    }
    auditTbody.innerHTML = snap.docs
      .map((d) => {
        const a = d.data();
        return `
          <tr>
            <td class="text-muted">${formatDateShort(a.timestamp)}</td>
            <td>${escapeHTML(a.action || "—")}</td>
            <td class="text-muted">${escapeHTML(a.user || "—")}</td>
            <td class="text-muted">${escapeHTML(a.details || "")}</td>
          </tr>`;
      })
      .join("");
  });
  unsubscribers.push(unsub);
}
