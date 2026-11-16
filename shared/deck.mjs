/* SPDX-License-Identifier: GPL-2.0-or-later
 * Physical-card ordering used by init_game() in ../rftgp/src/init.c.
 * This module works unchanged in Node and the browser.
 */

/** Number of physical instances of one card design in an online game. */
export function cardCopyCount(card, meta = {}) {
  const expansion = meta.expanded ?? meta.expansion ?? 0;
  if (!Number.isInteger(expansion) || expansion < 0 || expansion > 8) {
    throw new RangeError('Unknown expansion');
  }
  if (!meta.promo && card.flags.includes('PROMO')) return 0;
  const count = card.copies;
  if (!Array.isArray(count) || count.length !== 9) throw new TypeError('Invalid card catalog');
  const mask = (meta.arc1Mask ?? meta.arc1_mask ?? 0) & 7;
  let n;
  if (mask && expansion >= 1 && expansion <= 3 && !meta.camp) {
    n = (mask & 2) ? count[6] : (mask & 1) ? count[1] : count[0];
    if ((mask & 1) && (mask & 2)) n = count[2];
    if (mask & 4) n += count[3] - count[2];
    n = Math.max(0, n);
  } else n = count[expansion];
  if (!Number.isInteger(n) || n < 0) throw new RangeError('Invalid physical card count');
  return n;
}

/**
 * Return design ids indexed by the protocol's physical card index.
 * The main deck is not shuffled in memory: server/client RNG selects indices.
 * Frontier and System cards (zero ordinary copies) are created later by the
 * server; their design ids must be taken from MSG_STATUS_CARD.
 */
export function buildDeckDesigns(cards, meta = {}) {
  const result = [];
  for (const card of cards) {
    for (let n = cardCopyCount(card, meta); n > 0; --n) result.push(card.id);
  }
  if (result.length > 328) throw new RangeError('Deck exceeds the protocol capacity');
  return result;
}

export default buildDeckDesigns;
