// New-game controls follow gui.c: exp_toggle, xcs_option_toggled and
// update_sensitivity. Public expansion checkboxes are distinct from wire IDs.
import { EXPANSIONS } from './constants.mjs';

export const PUBLIC_EXPANSIONS = [0, 1, 2, 3, 4, 5, 8];
export const GAME_OPTIONS = [
  ['advanced', '双人进阶', 'Two-player advanced'],
  ['disableGoals', '关闭目标', 'Disable goals'],
  ['disableTakeovers', '关闭夺取', 'Disable takeovers'],
  ['orb', 'Orb 遗迹', 'Orb Game'],
  ['invasion', '异星入侵', 'Invasion Game'],
  ['frontier', '边境', 'Frontier Game'],
  ['counterstrike', '异星反击', 'Counterstrike Game'],
];
const family = id => id >= 1 && id <= 3 ? 1 : id === 4 ? 2 : id === 5 || id === 8 ? 3 : 0;

export function normalizeConfiguration(input = {}) {
  const c = { players: 2, ...Object.fromEntries(GAME_OPTIONS.map(([k]) => [k, false])), ...input,
    selected: [...(input.selected || [0])] };
  const chosen = new Set(c.selected);
  if (!chosen.size) chosen.add(0);
  c.expansion = [8, 5, 4, 3, 2, 1].find(id => chosen.has(id)) || 0;
  c.arc1Mask = [1, 2, 3].reduce((mask, id) => mask | (chosen.has(id) ? 1 << (id - 1) : 0), 0);
  c.maxPlayers = EXPANSIONS[c.expansion].max;
  c.players = Math.min(c.maxPlayers, Math.max(2, c.players));
  if (c.players !== 2) c.advanced = false;
  if (c.expansion !== 8) c.frontier = c.counterstrike = false;
  if (c.counterstrike) { c.frontier = c.invasion = true; chosen.add(5); }
  const xi = chosen.has(5);
  if (!xi) c.invasion = false;
  if (c.expansion !== 4) c.orb = false;
  const arc1 = c.expansion >= 1 && c.expansion <= 3;
  if (!arc1 || !c.arc1Mask) c.disableGoals = false;
  if (!arc1 || !(c.arc1Mask & 6)) c.disableTakeovers = false;
  c.enabled = {
    advanced: c.players === 2, disableGoals: arc1 && !!c.arc1Mask,
    disableTakeovers: arc1 && !!(c.arc1Mask & 6), orb: c.expansion === 4,
    invasion: xi && !c.counterstrike,
    frontier: c.expansion === 8 && !c.counterstrike,
    counterstrike: c.expansion === 8,
  };
  c.selected = PUBLIC_EXPANSIONS.filter(id => chosen.has(id));
  c.mode = c.counterstrike ? 4 : c.frontier ? c.invasion ? 5 : 3 : c.invasion ? 1 : c.orb ? 2 : 0;
  return c;
}

export function changeConfiguration(input, key, value) {
  const c = normalizeConfiguration(input);
  if (key === 'expansion') {
    const id = Number(value);
    if (!PUBLIC_EXPANSIONS.includes(id) || id === 5 && c.counterstrike) return c;
    const selected = new Set(c.selected);
    if (selected.has(id)) selected.delete(id);
    else {
      for (const other of selected) if (!family(id) || family(other) !== family(id)) selected.delete(other);
      selected.add(id);
    }
    c.selected = [...selected];
  } else if (key === 'players') c.players = Number(value);
  else if (c.enabled[key]) {
    c[key] = !!value;
    if (key === 'frontier' && !value) c.counterstrike = false;
  }
  return normalizeConfiguration(c);
}

export function configurationRequest(input) {
  const c = normalizeConfiguration(input);
  return { expansion: c.expansion, mode: c.mode, arc1Mask: c.arc1Mask,
    minPlayers: c.players, maxPlayers: c.players, advanced: c.advanced,
    disableGoals: c.disableGoals, disableTakeovers: c.disableTakeovers };
}
