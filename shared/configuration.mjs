// New-game controls intentionally expose only the base game and Arc 1.
import { EXPANSIONS } from './constants.mjs';

export const PUBLIC_EXPANSIONS = [0, 1, 2, 3];
export const GAME_OPTIONS = [
  ['advanced', '双人进阶', 'Two-player advanced'],
  ['disableGoals', '关闭目标', 'Disable goals'],
  ['disableTakeovers', '关闭夺取', 'Disable takeovers'],
];
const OPTION_KEYS = GAME_OPTIONS.map(([key]) => key);
const family = id => id >= 1 && id <= 3 ? 1 : 0;

export function normalizeConfiguration(input = {}) {
  const c = { players: 2, ...Object.fromEntries(GAME_OPTIONS.map(([k]) => [k, false])) };
  if (Number.isInteger(input.players)) c.players = input.players;
  for (const key of OPTION_KEYS) if (typeof input[key] === 'boolean') c[key] = input[key];
  const chosen = new Set((Array.isArray(input.selected) ? input.selected : [0])
    .map(Number).filter(id => PUBLIC_EXPANSIONS.includes(id)));
  if (!chosen.size) chosen.add(0);
  c.expansion = [3, 2, 1].find(id => chosen.has(id)) || 0;
  c.arc1Mask = [1, 2, 3].reduce((mask, id) => mask | (chosen.has(id) ? 1 << (id - 1) : 0), 0);
  c.maxPlayers = EXPANSIONS[c.expansion].max;
  c.players = Math.min(c.maxPlayers, Math.max(2, c.players));
  if (c.players !== 2) c.advanced = false;
  const arc1 = c.expansion >= 1 && c.expansion <= 3;
  if (!arc1 || !c.arc1Mask) c.disableGoals = false;
  if (!arc1 || !(c.arc1Mask & 6)) c.disableTakeovers = false;
  c.enabled = {
    advanced: c.players === 2, disableGoals: arc1 && !!c.arc1Mask,
    disableTakeovers: arc1 && !!(c.arc1Mask & 6),
  };
  c.selected = PUBLIC_EXPANSIONS.filter(id => chosen.has(id));
  c.mode = 0;
  return c;
}

export function changeConfiguration(input, key, value) {
  const c = normalizeConfiguration(input);
  if (key === 'expansion') {
    const id = Number(value);
    if (!PUBLIC_EXPANSIONS.includes(id)) return c;
    const selected = new Set(c.selected);
    if (selected.has(id)) selected.delete(id);
    else {
      for (const other of selected) if (!family(id) || family(other) !== family(id)) selected.delete(other);
      selected.add(id);
    }
    c.selected = [...selected];
  } else if (key === 'players') c.players = Number(value);
  else if (OPTION_KEYS.includes(key) && c.enabled[key]) c[key] = !!value;
  return normalizeConfiguration(c);
}

export function configurationRequest(input) {
  const c = normalizeConfiguration(input);
  return { expansion: c.expansion, mode: c.mode, arc1Mask: c.arc1Mask,
    minPlayers: c.players, maxPlayers: c.players, advanced: c.advanced,
    disableGoals: c.disableGoals, disableTakeovers: c.disableTakeovers };
}
