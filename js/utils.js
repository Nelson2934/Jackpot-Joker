// js/utils.js
// Shared helpers used by both the public display and the admin dashboard.

/* ---------------------------------------------------------------------- *
 * CRYPTOGRAPHICALLY SECURE RANDOMNESS
 * Math.random() is explicitly banned by the spec. Everything below uses
 * crypto.getRandomValues() with rejection sampling so every outcome in
 * [0, max) is equally likely (no modulo bias).
 * ---------------------------------------------------------------------- */

/**
 * Returns a cryptographically secure random integer in [0, max).
 * Uses rejection sampling to avoid modulo bias.
 */
export function secureRandomInt(max) {
  if (!Number.isInteger(max) || max <= 0) {
    throw new Error("secureRandomInt: max must be a positive integer");
  }
  const arr = new Uint32Array(1);
  // Largest multiple of `max` that is <= 2^32, used to reject values that
  // would otherwise skew the distribution.
  const limit = Math.floor(0x100000000 / max) * max;
  let value;
  do {
    crypto.getRandomValues(arr);
    value = arr[0];
  } while (value >= limit);
  return value % max;
}

/** Picks one element from an array using secure randomness. */
export function secureRandomChoice(array) {
  if (!array || array.length === 0) return null;
  return array[secureRandomInt(array.length)];
}

/** Fisher-Yates shuffle using secure randomness (not currently required, but handy). */
export function secureShuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------------------------------------------------------------------- *
 * FORMATTING
 * ---------------------------------------------------------------------- */

export function formatGBP(amount) {
  const n = Number(amount) || 0;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(n);
}

export function formatDate(value) {
  if (!value) return "TBC";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "TBC";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatDateShort(value) {
  if (!value) return "—";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/* ---------------------------------------------------------------------- *
 * TOASTS
 * Expects a <div id="toastRoot"></div> to exist somewhere on the page.
 * ---------------------------------------------------------------------- */

export function showToast(message, type = "info", duration = 4200) {
  let root = document.getElementById("toastRoot");
  if (!root) {
    root = document.createElement("div");
    root.id = "toastRoot";
    root.className = "toast-root";
    document.body.appendChild(root);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.setAttribute("role", "status");

  const icon = { success: "✓", error: "✕", warning: "!", info: "i" }[type] || "i";
  toast.innerHTML = `<span class="toast__icon">${icon}</span><span class="toast__msg"></span>`;
  toast.querySelector(".toast__msg").textContent = message;

  root.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("toast--visible"));

  const remove = () => {
    toast.classList.remove("toast--visible");
    setTimeout(() => toast.remove(), 250);
  };
  const timer = setTimeout(remove, duration);
  toast.addEventListener("click", () => {
    clearTimeout(timer);
    remove();
  });
}

/* ---------------------------------------------------------------------- *
 * CONFIRMATION DIALOG
 * Expects a modal shell in the host page with id="confirmDialog".
 * Falls back to window.confirm if the markup isn't present.
 * ---------------------------------------------------------------------- */

export function confirmAction({ title = "Are you sure?", message = "", confirmLabel = "Confirm", danger = true } = {}) {
  const dialog = document.getElementById("confirmDialog");
  if (!dialog) {
    return Promise.resolve(window.confirm(message || title));
  }

  return new Promise((resolve) => {
    dialog.querySelector(".confirm-dialog__title").textContent = title;
    dialog.querySelector(".confirm-dialog__message").textContent = message;
    const confirmBtn = dialog.querySelector(".confirm-dialog__confirm");
    const cancelBtn = dialog.querySelector(".confirm-dialog__cancel");
    confirmBtn.textContent = confirmLabel;
    confirmBtn.classList.toggle("btn--danger", danger);
    confirmBtn.classList.toggle("btn--primary", !danger);

    dialog.classList.add("confirm-dialog--open");
    dialog.setAttribute("aria-hidden", "false");

    const cleanup = (result) => {
      dialog.classList.remove("confirm-dialog--open");
      dialog.setAttribute("aria-hidden", "true");
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      dialog.removeEventListener("click", onBackdrop);
      resolve(result);
    };
    const onConfirm = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (e) => {
      if (e.target === dialog) cleanup(false);
    };

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    dialog.addEventListener("click", onBackdrop);
  });
}

/* ---------------------------------------------------------------------- *
 * CSV EXPORT
 * ---------------------------------------------------------------------- */

export function exportToCSV(filename, rows, headers) {
  const escape = (val) => {
    const s = val === null || val === undefined ? "" : String(val);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [];
  if (headers) lines.push(headers.map(escape).join(","));
  rows.forEach((row) => lines.push(row.map(escape).join(",")));

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Minimal HTML-escaping for values interpolated into innerHTML templates. */
export function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/** Simple debounce for search inputs etc. */
export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
