#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-2.0-or-later */
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildDeckDesigns } from '../shared/deck.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = async path => JSON.parse(await readFile(join(project, 'public/data', path), 'utf8'));
const [cards, assets, game, provenance] = await Promise.all([
  load('cards.json'), load('assets.json'), load('game.json'), load('provenance.json'),
]);
assert.equal(cards.length, 364);
assert.equal(provenance.bundleImages, 419);
assert.equal(Object.keys(assets.cards).length, cards.length);
assert.equal(game.goals.length, 20);
assert.equal(cards[6].name, 'Old Earth');
assert.deepEqual([cards[6].type, cards[6].cost, cards[6].vp], [1, 3, 2]);
assert.equal(cards[6].powers[1].times, 2);
assert.equal(cards[363].name, 'Xeno Hive World 5');
assert.equal(cards[363].cost, 127); // The native engine's dynamic-defence sentinel.
for (let id = 0; id < cards.length; ++id) {
  const card = cards[id];
  assert.equal(card.id, id);
  assert.equal(card.index, id);
  assert.equal(card.image, assets.cards[id]);
  assert.equal(card.flags.includes('PEACEFUL'), card.type === 1 && !card.flags.includes('MILITARY'));
  for (const power of card.powers) {
    const mask = power.flags.reduce((n, name) => n | (1n << BigInt(game.powerFlags[power.phase].indexOf(name))), 0n);
    assert.equal(BigInt(power.code), mask);
  }
  if (card.xcs && ['near-frontier', 'far-frontier', 'system'].includes(card.xcs.category)) {
    assert.deepEqual(card.copies, Array(9).fill(0));
  }
}
const expectedSizes = [114, 136, 180, 228, 160, 165, 158, 146, 197];
for (let expanded = 0; expanded < 9; ++expanded) {
  const deck = buildDeckDesigns(cards, { expanded });
  assert.equal(deck.length, expectedSizes[expanded]);
  assert.equal(buildDeckDesigns(cards, { expanded, promo: 1 }).length, expectedSizes[expanded] + 6);
  assert(deck.every(id => !cards[id].flags.includes('PROMO')));
}
assert.equal(buildDeckDesigns(cards, { expanded: 0 })[0], 6);
const exactArcSizes = [136, 158, 180, 162, 184, 206, 228];
for (let arc1Mask = 1; arc1Mask <= 7; ++arc1Mask) {
  assert.equal(buildDeckDesigns(cards, { expanded: 3, arc1Mask }).length, exactArcSizes[arc1Mask - 1]);
}
const paths = new Set([
  ...Object.values(assets.cards), assets.cardBack, ...Object.values(assets.goals),
  ...Object.values(assets.icons), ...Object.values(assets.actions), ...assets.expansionFiles,
]);
for (const path of paths) await access(join(project, 'public', path));
for (const [path, expectedHash] of Object.entries(provenance.files)) {
  const bytes = await readFile(join(project, '../rftgp', path));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash, `Source hash changed: ${path}`);
}
console.log(`Asset checks passed: ${cards.length} card designs, ${paths.size} files, nine expansion decks and seven exact Arc 1 selections.`);
