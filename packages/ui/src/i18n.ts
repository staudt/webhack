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
  'ui.save': 'Save',
  'ui.load': 'Load',
  'ui.nosave': 'No saved game found.',
  'ui.error': 'Error: {message}',
  'ui.history': 'Message history',
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
 * is itself translated as a key first. Missing keys render as `[key]` (warned once).
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
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    if (v === undefined) return whole;
    if (typeof v === 'string' && v.startsWith('@') && depth < 4) {
      return translate(catalogs, locale, v.slice(1), undefined, depth + 1);
    }
    return String(v);
  });
}

/** Merge `add` into the catalog of `locale`; later wins. */
export function mergeMessages(
  catalogs: Catalogs,
  locale: string,
  add: Record<string, string>,
): void {
  catalogs[locale] = { ...catalogs[locale], ...add };
}
