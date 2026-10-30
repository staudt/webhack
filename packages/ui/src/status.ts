import type { ViewUpdate } from '@nh/core';
import { uiMessagesEn } from './i18n';

type Status = ViewUpdate['status'];

/** NetHack's get_strength_str. ref: src/botl.c get_strength_str() */
export function formatStr(st: number): string {
  if (st <= 18) return String(st);
  if (st > 118) return String(st - 100);
  if (st === 118) return '18/**';
  return `18/${String(st - 18).padStart(2, '0')}`;
}

export type HpLevel = 'ok' | 'warn' | 'crit';

/** Critical (red) when hp < max/7 or hp < 6; warning (yellow) when hp < max/3. */
export function hpLevel(hp: number, max: number): HpLevel {
  if (hp < max / 7 || hp < 6) return 'crit';
  if (hp < max / 3) return 'warn';
  return 'ok';
}

export interface StatusField {
  text: string;
  cls?: string;
}

const num = (s: Status, k: string): number | undefined => {
  const v = s[k];
  return typeof v === 'number' ? v : undefined;
};

const HUNGER_CLASS: Record<string, string> = {
  hungry: 'nh-hp-warn',
  weak: 'nh-hp-crit',
  fainting: 'nh-hp-crit',
  fainted: 'nh-hp-crit',
};
const ENC_CLASS: Record<string, string> = {
  strained: 'nh-hp-crit',
  overtaxed: 'nh-hp-crit',
  overloaded: 'nh-hp-crit',
};

/** The two NetHack bottom lines; missing fields are omitted. ref: src/botl.c */
export function statusLines(
  s: Status,
  t: (key: string) => string = (k) => uiMessagesEn[k] ?? k,
): [StatusField[], StatusField[]] {
  const l1: StatusField[] = [];
  const l2: StatusField[] = [];
  const str = num(s, 'str');
  if (str !== undefined) l1.push({ text: `St:${formatStr(str)}` });
  for (const [k, label] of [
    ['dex', 'Dx'],
    ['con', 'Co'],
    ['int', 'In'],
    ['wis', 'Wi'],
    ['cha', 'Ch'],
  ] as const) {
    const v = num(s, k);
    if (v !== undefined) l1.push({ text: `${label}:${v}` });
  }
  const dlvl = num(s, 'dlvl');
  if (dlvl !== undefined) l2.push({ text: `Dlvl:${dlvl}` });
  const gold = num(s, 'gold');
  if (gold !== undefined) l2.push({ text: `$:${gold}` });
  const hp = num(s, 'hp');
  const hpmax = num(s, 'hpmax');
  if (hp !== undefined && hpmax !== undefined) {
    l2.push({ text: `HP:${hp}(${hpmax})`, cls: `nh-hp-${hpLevel(hp, hpmax)}` });
  }
  const ac = num(s, 'ac');
  if (ac !== undefined) l2.push({ text: `AC:${ac}` });
  const xl = num(s, 'xl');
  if (xl !== undefined) {
    const xp = num(s, 'xp');
    l2.push({ text: xp !== undefined ? `Xp:${xl}/${xp}` : `Xp:${xl}` });
  }
  const turn = num(s, 'turn');
  if (turn !== undefined) l2.push({ text: `T:${turn}` });
  const hunger = s['hunger'];
  if (typeof hunger === 'string') {
    const cls = HUNGER_CLASS[hunger];
    l2.push({ text: t(`ui.status.${hunger}`), ...(cls ? { cls } : {}) });
  }
  const enc = s['encumbrance'];
  if (typeof enc === 'string') {
    const cls = ENC_CLASS[enc];
    l2.push({ text: t(`ui.status.${enc}`), ...(cls ? { cls } : {}) });
  }
  return [l1, l2];
}

/** English indefinite article. */
export function an(word: string): string {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}

/** Headstone art (text only), adapted loosely from rip.c. */
export function ripArt(lines: string[]): string {
  const w = Math.max(22, ...lines.map((l) => l.length));
  const center = (s: string): string => {
    const pad = w - s.length;
    const left = Math.floor(pad / 2);
    return ' '.repeat(left) + s + ' '.repeat(pad - left);
  };
  // Stone edges: '|' at columns 2 and w + 3; the roof slopes in by one column per line.
  const row = (s: string): string => `  |${center(s)}|`;
  const out = [
    `    ${'-'.repeat(w - 2)}`,
    `   /${' '.repeat(w - 2)}\\`,
    ...lines.map(row),
    row(''),
    ` *|${center('*  *  *')}|*`,
    '_'.repeat(w + 6),
  ];
  return out.join('\n');
}
