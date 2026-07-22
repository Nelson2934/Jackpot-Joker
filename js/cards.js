// js/cards.js — shared card-art helpers used by both public.js and admin.js
// so the deck looks identical (same suit per card number, same colors)
// wherever it's rendered.

const SUITS = [
  { key: "spade", glyph: "♠", color: "ink" },
  { key: "heart", glyph: "♥", color: "red" },
  { key: "club", glyph: "♣", color: "ink" },
  { key: "diamond", glyph: "♦", color: "red" },
];

/** Deterministically assigns a decorative suit to a given card number. */
export function suitForCard(cardNumber) {
  return SUITS[(cardNumber - 1) % SUITS.length];
}

/**
 * Markup for a card's back face — corner indices + a central numbered
 * medallion. Used for every card in the grid before (and, if taken,
 * permanently after) it's revealed.
 */
export function cardBackHTML(cardNumber, { asButton = false, disabled = false, ariaLabel } = {}) {
  const suit = suitForCard(cardNumber);
  const index = `
    <span class="card-face__number">${cardNumber}</span>
    <span class="card-face__suit-icon">${suit.glyph}</span>`;
  const inner = `
    ${asButton ? `<button class="card-hit" type="button" ${disabled ? "disabled" : ""} aria-label="${ariaLabel || `Card ${cardNumber}`}"></button>` : ""}
    <span class="card-face__index card-face__index--tl">${index}</span>
    <div class="card-face__medallion">${index}</div>
    <span class="card-face__index card-face__index--br">${index}</span>
  `;
  return `<div class="card-face card-face--back">${inner}</div>`;
}

/** Markup for a card's front face when it turns out to be a standard card. */
export function cardStandardFrontHTML(cardNumber) {
  const suit = suitForCard(cardNumber);
  const colorClass = `card-face__suit-icon--${suit.color}`;
  const index = `
    <span class="card-face__number">${cardNumber}</span>
    <span class="card-face__suit-icon ${colorClass}">${suit.glyph}</span>`;
  return `
    <div class="card-face card-face--front" aria-hidden="true">
      <span class="card-face__index card-face__index--tl">${index}</span>
      <span class="card-face__watermark ${colorClass}">${suit.glyph}</span>
      <span class="card-face__number ${colorClass}">${cardNumber}</span>
      <span class="card-face__index card-face__index--br">${index}</span>
    </div>`;
}

/** Markup for a card's front face when it's revealed to be the Joker. */
export function cardJokerFrontHTML() {
  return `
    <div class="card-face card-face--front is-joker" aria-hidden="true">
      <span class="card-face__joker-corner card-face__joker-corner--tl">JOKER</span>
      <span class="card-face__joker-icon">🃏</span>
      <span class="card-face__joker-corner card-face__joker-corner--br">JOKER</span>
    </div>`;
}
