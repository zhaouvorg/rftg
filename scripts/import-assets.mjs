#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-2.0-or-later
 * Translate the existing card catalog and unpack its artwork for the web client.
 * No compiler, native game executable, WebAssembly, or third-party modules needed.
 */
import { mkdir, readFile, writeFile, readdir, copyFile } from 'node:fs/promises';
import { resolve, dirname, extname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceOption = process.argv.indexOf('--source');
const source = sourceOption >= 0
  ? resolve(process.argv[sourceOption + 1]) : resolve(project, '../rftgp');
const output = join(project, 'public');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async (path, data) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
};
function assert(ok, message) { if (!ok) throw new Error(message); }

const [init, header, engine, gui, cardsFile, bundle, xcsSource] = await Promise.all([
  readFile(join(source, 'src/init.c'), 'utf8'),
  readFile(join(source, 'src/rftg.h'), 'utf8'),
  readFile(join(source, 'src/engine.c'), 'utf8'),
  readFile(join(source, 'src/gui.c'), 'utf8'),
  readFile(join(source, 'src/cards.txt'), 'utf8'),
  readFile(join(source, 'src/images.data')),
  readFile(join(source, 'src/xcs_catalog.c'), 'utf8'),
]);

function arrayBody(text, name) {
  const found = text.match(new RegExp(`\\b${name}\\[[^;=]*=\\s*\\{([\\s\\S]*?)\\r?\\n\\};`));
  assert(found, `Cannot find C array ${name}`);
  return found[1];
}
function cStrings(text) {
  return [...text.matchAll(/"(?:\\.|[^"\\])*"/g)].map(m => JSON.parse(m[0]));
}
function cStringEntries(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').split(/,(?=\s*(?:"|$))/)
    .map(part => cStrings(part).join('')).filter(Boolean);
}
const flagNames = cStrings(arrayBody(init, 'flag_name'));
const goodNames = cStrings(arrayBody(init, 'good_name'));
const vpNames = cStrings(arrayBody(init, 'vp_name'));
const powerNames = [...arrayBody(init, 'power_name').matchAll(/\{([^{}]*)\}/g)]
  .map(m => cStrings(m[1]));
assert(powerNames.length === 6, 'Six power flag tables expected');
const constants = {};
for (const m of header.matchAll(/^#define\s+([A-Z0-9_]+)\s+(-?(?:0x[0-9a-f]+|\d+))(?=\s|$)/gmi)) {
  constants[m[1]] = Number(m[2]);
}
const successors = [...arrayBody(init, 'succ_in_arc').matchAll(/\{([^{}]+)\}/g)]
  .map(m => m[1].split(',').map(t => {
    t = t.trim(); return /^-?\d+$/.test(t) ? Number(t) : constants[t];
  }).filter(v => v !== -1));
assert(successors.length === 9 && successors.every(row => row.every(Number.isInteger)),
  'Invalid expansion successor table');
function bitMask(names, list, label) {
  return list.reduce((mask, name) => {
    const bit = names.indexOf(name);
    assert(bit >= 0, `Unknown ${label}: ${name}`);
    return mask | (1n << BigInt(bit));
  }, 0n).toString();
}

const cards = [];
let card;
for (const sourceLine of cardsFile.split(/\r?\n/)) {
  const line = sourceLine.trim();
  if (!line || line.startsWith('#')) continue;
  const fields = line.slice(2).split(':');
  if (line.startsWith('N:')) {
    card = { id: cards.length, index: cards.length, name: line.slice(2),
      type: 0, cost: 0, vp: 0, flags: [], flagBits: '0',
      goodType: 0, goodName: '', introduced: Array(9).fill(0),
      copies: Array(9).fill(0), powers: [], bonuses: [] };
    cards.push(card);
    continue;
  }
  assert(card, 'Card properties before card name');
  switch (line[0]) {
    case 'T': [card.type, card.cost, card.vp] = fields.map(Number); break;
    case 'E': {
      for (const m of line.matchAll(/@(\d+):(-?\d+)/g)) {
        const expansion = Number(m[1]), count = Number(m[2]);
        assert(successors[expansion], `Unknown expansion ${expansion}`);
        card.introduced[expansion] += count;
        for (const target of successors[expansion]) card.copies[target] += count;
      }
      break;
    }
    case 'F': card.flags.push(...line.slice(2).split('|').map(s => s.trim())); break;
    case 'G':
      card.goodName = fields[0]; card.goodType = goodNames.indexOf(fields[0]);
      assert(card.goodType >= 0, `Unknown good: ${fields[0]}`); break;
    case 'P': {
      const phase = Number(fields[0]);
      const flags = fields[1].split('|').map(s => s.trim());
      card.powers.push({ phase, flags, code: bitMask(powerNames[phase], flags, 'power'),
        value: Number(fields[2]), times: Number(fields[3]) });
      break;
    }
    case 'V': {
      const other = fields[1].startsWith('OTHER_');
      const name = other ? fields[1].slice(6) : fields[1];
      const type = vpNames.indexOf(name);
      assert(type >= 0, `Unknown VP bonus ${name}`);
      card.bonuses.push({ value: Number(fields[0]), type, kind: name,
        other, name: fields.slice(2).join(':') });
      break;
    }
    default: throw new Error(`Unrecognized card line: ${line}`);
  }
}
for (const c of cards) {
  if (c.type === 1 && !c.flags.includes('MILITARY') && !c.flags.includes('PEACEFUL')) {
    c.flags.push('PEACEFUL');
  }
  c.flagBits = bitMask(flagNames, c.flags, 'card flag');
  assert(c.type === 1 || c.type === 2, `Invalid type for ${c.name}`);
  assert(c.powers.length <= 6 && c.bonuses.length <= 6, `Invalid catalog entry ${c.name}`);
}
const xcsCategories = ['start', 'game', 'near-frontier', 'far-frontier', 'system'];
for (const m of xcsSource.matchAll(/\{"([^"\n]+)",(\d+),(\d+),(\d+)\}/g)) {
  const c = cards.find(c => c.name === m[1]);
  assert(c, `XCS catalog missing card ${m[1]}`);
  c.xcs = { category: xcsCategories[Number(m[2])], categoryId: Number(m[2]),
    localId: Number(m[3]), physicalCopies: Number(m[4]) };
}

const assets = { cards: {}, cardBack: null, goals: {}, icons: {}, actions: {}, xeno: {},
  expansionFiles: [] };
const kindNames = { 1: 'cards', 2: 'card-back', 3: 'goals', 4: 'icons', 5: 'actions', 6: 'xeno' };
assert(bundle.subarray(0, 4).toString() === 'RFTG', 'Invalid image bundle header');
let position = 4, imageCount = 0;
while (position < bundle.length) {
  const kind = bundle[position++];
  if (kind === 0) break;
  assert(kindNames[kind], `Invalid image kind ${kind}`);
  const width = kind === 1 ? 4 : kind === 2 ? 0 : 3;
  assert(position + width + 8 <= bundle.length, 'Truncated bundle header');
  const id = width ? Number.parseInt(bundle.subarray(position, position + width).toString(), 10) : 0;
  position += width;
  const length = Number.parseInt(bundle.subarray(position, position + 8).toString(), 10);
  position += 8;
  assert(Number.isInteger(id) && length > 0 && position + length <= bundle.length,
    'Invalid bundle index or image length');
  const bytes = bundle.subarray(position, position + length);
  position += length;
  const extension = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpg'
    : bytes[0] === 0x89 && bytes.subarray(1, 4).toString() === 'PNG' ? 'png'
    : bytes.subarray(0, 4).toString() === 'RIFF' ? 'webp' : null;
  assert(extension, `Unknown image format, kind ${kind}, id ${id}`);
  const url = kind === 2 ? `/assets/card-back.${extension}` : `/assets/${kindNames[kind]}/${id}.${extension}`;
  const path = join(output, url);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  if (kind === 2) assets.cardBack = url;
  else assets[kindNames[kind]][id] = url;
  if (kind === 1) {
    assert(cards[id], `Image references undefined card ${id}`);
    cards[id].image = url;
  }
  imageCount++;
}
assert(cards.length && cards.every(c => c.image), 'Missing card images');
assert(assets.cardBack, 'Missing card back image');

async function copyExpansionAssets(dir) {
  const here = join(source, 'assets', dir);
  for (const entry of await readdir(here, { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) { await copyExpansionAssets(rel); continue; }
    if (!/\.(png|jpe?g|webp|json)$/i.test(entry.name)) continue;
    const dest = join(output, 'assets', rel);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(join(source, 'assets', rel), dest);
    assets.expansionFiles.push(`/assets/${rel.split('\\').join('/')}`);
  }
}
for (const dir of ['orb', 'xeno', 'xcs']) await copyExpansionAssets(dir);
assets.expansionFiles.sort();

const goalNames = cStringEntries(arrayBody(engine, 'goal_name'));
const goalDescriptions = cStringEntries(arrayBody(gui, 'goal_description'));
assert(goalNames.length === 20 && goalDescriptions.length === 20, 'Invalid goal names');
const actionNames = cStringEntries(arrayBody(engine, 'actname'));
const actionLabels = ['搜索', '探索 +5', '探索 +1/+1', '开发', '第二次开发', '扩张', '第二次扩张', '消费：交易', '消费：双倍分', '生产', '生产：修复'];
const expansionNames = ['Base game', 'The Gathering Storm', 'Rebel vs Imperium', 'The Brink of War', 'Alien Artifacts', 'Xeno Invasion', 'Rebel vs Imperium only', 'Xeno Counterstrike', 'Xeno Invasion + Counterstrike'];
const expansionLabels = ['基础游戏', '风云际会', '反抗军与帝国', '战争边缘', '异星遗迹', '异种入侵', '反抗军与帝国（独立）', '异种反击', '异种入侵 + 反击'];
const game = {
  schema: 1,
  cardCount: cards.length,
  expansionSuccessors: successors,
  flags: flagNames,
  powerFlags: powerNames,
  goods: goodNames.map((name, id) => ({ id, name, label: ['无', '任意', '新奇品', '稀有元素', '基因', '异星科技'][id] })),
  goals: goalNames.map((name, id) => ({ id, name, description: goalDescriptions[id], image: assets.goals[id], kind: id < 12 ? 'first' : 'most' })),
  actions: actionNames.slice(0, 11).map((name, id) => ({ id, name, label: actionLabels[id], image: assets.actions[id], icon: assets.icons[id] })).concat([
    { id: 11, name: 'Explore: Orb', label: '探索：异星球体', image: '/assets/orb/ui/explore_orb_action.png', icon: '/assets/orb/ui/explore_orb_action_icon.png' },
    { id: 12, name: 'Frontier Settle', label: '边疆扩张', image: '/assets/xcs/ui/frontier_settle_action.png' },
  ]),
  expansions: expansionNames.map((name, id) => ({ id, name, label: expansionLabels[id] })),
  modes: ['Normal', 'Invasion', 'Orb', 'Frontier', 'Counterstrike', 'Invasion + Frontier'].map((name, id) => ({ id, name, label: ['普通', '异种入侵战', '异星球体', '边疆', '异种反击战', '入侵 + 边疆'][id] })),
  constants,
};
const provenance = {
  schema: 1,
  source: '../rftgp',
  files: { 'src/cards.txt': hash(cardsFile), 'src/images.data': hash(bundle),
    'src/init.c': hash(init), 'src/rftg.h': hash(header) },
  cardCount: cards.length, bundleImages: imageCount,
  expansionAssets: assets.expansionFiles.length,
  deckOrder: 'Card designs in cards.txt order; each design repeated by its cumulative expansion count. Promo cards omitted unless explicitly enabled. XCS side-deck designs materialize from MSG_STATUS_CARD design_index.',
  artwork: 'Race for the Galaxy card and other artwork: Rio Grande Games. Game design: Tom Lehmann. Existing artwork retains its original copyright; see ASSET_LICENSES.md.',
};
await Promise.all([
  json(join(output, 'data/cards.json'), cards),
  json(join(output, 'data/assets.json'), assets),
  json(join(output, 'data/game.json'), game),
  json(join(output, 'data/provenance.json'), provenance),
  copyFile(join(source, 'src/COPYING'), join(project, 'LICENSE.assets-code')),
]);
console.log(`Imported ${cards.length} card designs, ${imageCount} bundled images, and ${assets.expansionFiles.length} expansion assets.`);
console.log(`Catalog: ${relative(project, join(output, 'data/cards.json'))}`);
