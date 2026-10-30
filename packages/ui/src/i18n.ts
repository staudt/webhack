import type { Params } from '@nh/core';

export type Catalogs = Record<string, Record<string, string>>;

export const DEFAULT_LOCALE = 'en';

export const uiMessagesEn: Record<string, string> = {
  'ui.menu': 'Menu',
  'ui.actions': 'Actions',
  'ui.look': 'You see: {what}.',
  'ui.look.remembered': '{what} (remembered)',
  'ui.look.mode': 'Look',
  'ui.cancel': 'Cancel',
  'ui.yes': 'Yes',
  'ui.no': 'No',
  'ui.saved': 'Game saved.',
  'ui.loaded': 'Game restored.',
  'ui.newgame': 'New game',
  'ui.rip.title': 'You died',
  'ui.rip.rest': 'REST IN PEACE',
  'ui.rip.killed_by': 'killed by {killer}',
  'ui.rip.turn': 'on turn {turn}',
  'ui.rip.dlvl': 'on level {dlvl}',
  'ui.rip.xl': 'experience level {xl}',
  'ui.escaped': 'You escaped the dungeon.',
  'ui.save_incompatible':
    "Your saved game is from an older version and can't be restored. Starting a new game.",
  'ui.save': 'Save',
  'ui.load': 'Load',
  'ui.nosave': 'No saved game found.',
  'ui.error': 'Error: {message}',
  'ui.history': 'Message history',
  'ui.look.more': 'and {n} more objects',
  'ui.look.more1': 'and 1 more object',
  'ui.inventory': 'Inventory',
  'ui.inventory.empty': 'Not carrying anything.',
  'ui.close': 'Close',
  'ui.confirm': 'Confirm',
  'ui.class.coin': 'Coins',
  'ui.class.weapon': 'Weapons',
  'ui.class.armor': 'Armor',
  'ui.class.food': 'Comestibles',
  'ui.class.scroll': 'Scrolls',
  'ui.class.potion': 'Potions',
  'ui.class.other': 'Other',
  'ui.equipped.weapon': 'weapon in hand',
  'ui.equipped.worn': 'being worn',
  'ui.item': '{letter} - {name}',
  'ui.item.equipped': '{letter} - {name} ({how})',
  'ui.status.hungry': 'Hungry',
  'ui.status.weak': 'Weak',
  'ui.status.fainting': 'Fainting',
  'ui.status.fainted': 'Fainted',
  'ui.status.satiated': 'Satiated',
  'ui.status.burdened': 'Burdened',
  'ui.status.stressed': 'Stressed',
  'ui.status.strained': 'Strained',
  'ui.status.overtaxed': 'Overtaxed',
  'ui.status.overloaded': 'Overloaded',
  'ui.pick.nh:drop': 'What do you want to drop?',
  'ui.pick.none.nh:drop': "You don't have anything to drop.",
  'ui.pick.nh:wield': 'What do you want to wield?',
  'ui.pick.none.nh:wield': "You don't have anything to wield.",
  'ui.pick.nh:wear': 'What do you want to wear?',
  'ui.pick.none.nh:wear': "You don't have anything to wear.",
  'ui.pick.nh:takeoff': 'What do you want to take off?',
  'ui.pick.none.nh:takeoff': "You don't have anything to take off.",
  'ui.pick.nh:eat': 'What do you want to eat?',
  'ui.pick.none.nh:eat': "You don't have anything to eat.",
  'ui.pick.nh:quaff': 'What do you want to drink?',
  'ui.pick.none.nh:quaff': "You don't have anything to drink.",
  'ui.pick.nh:read': 'What do you want to read?',
  'ui.pick.none.nh:read': "You don't have anything to read.",
  'ui.pick.nh:throw': 'What do you want to throw?',
  'ui.pick.none.nh:throw': "You don't have anything to throw.",
  'describe.unexplored': 'You have not explored that spot.',
};

const warned = new Set<string>();

function lookup(catalogs: Catalogs, locale: string, key: string): string | undefined {
  const own = catalogs[locale]?.[key];
  if (own !== undefined) return own;
  return catalogs[DEFAULT_LOCALE]?.[key];
}

/**
 * Translate `key`. `{name}` placeholders take params; a string param starting with '@'
 * is itself translated as a key first, and a `{ key, params }` param is translated recursively. `{name|an}` prefixes the
 * English indefinite article (none before a number or "the ..."). Missing keys render as `[key]` (warned once).
 */
export function translate(
  catalogs: Catalogs,
  locale: string,
  key: string,
  params?: Params,
  depth = 0,
): string {
  const template = lookup(catalogs, locale, key);
  if (template === undefined) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[ui] missing message key: ${key}`);
    }
    return `[${key}]`;
  }
  if (!params) return template;
  return template.replace(/\{(\w+)(\|an)?\}/g, (whole, name: string, mod?: string) => {
    const v = params[name];
    if (v === undefined) return whole;
    let text: string;
    if (typeof v === 'string' && v.startsWith('@') && depth < 4) {
      text = translate(catalogs, locale, v.slice(1), undefined, depth + 1);
    } else if (typeof v === 'object') {
      text = depth < 4 ? translate(catalogs, locale, v.key, v.params, depth + 1) : `[${v.key}]`;
    } else {
      text = String(v);
    }
    return mod === '|an' ? justAn(text) + text : text;
  });
}

/**
 * English indefinite article for `str` ("an " / "a " / ""), used by the `{param|an}` modifier.
 * ref: src/objnam.c just_an()
 */
export function justAn(str: string): string {
  const s = str.toLowerCase();
  const c0 = s.charAt(0);
  if (/^\d/.test(s)) return ''; // "2 daggers": doname gives quantities instead of articles
  if (s.length === 1 || s.charAt(1) === ' ') return 'aefhilmnosx'.includes(c0) ? 'an ' : 'a ';
  if (s.startsWith('the ') || s === 'molten lava' || s === 'iron bars' || s === 'ice') return '';
  const vowels = 'aeiou';
  const exception =
    (s.startsWith('one') && (s.length === 3 || '-_ '.includes(s.charAt(3)))) ||
    ['eu', 'uke', 'ukulele', 'unicorn', 'uranium', 'useful'].some((p) => s.startsWith(p));
  if ((vowels.includes(c0) && !exception) || (c0 === 'x' && !vowels.includes(s.charAt(1))))
    return 'an ';
  return 'a ';
}

/** Merge `add` into the catalog of `locale`; later wins. */
export function mergeMessages(
  catalogs: Catalogs,
  locale: string,
  add: Record<string, string>,
): void {
  catalogs[locale] = { ...catalogs[locale], ...add };
}
