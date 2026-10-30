import type { ViewItem } from '@nh/core';

/**
 * Class display order. ref: src/options.c def_inv_order (coins, weapons, armor, food, scrolls,
 * potions, gems; the other classes are not in the game yet).
 */
export const CLASS_ORDER: string[] = ['coin', 'weapon', 'armor', 'food', 'scroll', 'potion', 'gem'];

export interface InventoryGroup {
  cls: string;
  items: ViewItem[];
}

/** Group by class in NetHack's order; items keep their (letter) order within a class. */
export function groupInventory(items: readonly ViewItem[]): InventoryGroup[] {
  const rank = (c: string): number => {
    const i = CLASS_ORDER.indexOf(c);
    return i < 0 ? CLASS_ORDER.length : i;
  };
  const classes = [...new Set(items.map((i) => i.cls as string))].sort(
    (a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0),
  );
  return classes.map((cls) => ({ cls, items: items.filter((i) => i.cls === cls) }));
}

export const classKey = (cls: string): string =>
  CLASS_ORDER.includes(cls) ? `ui.class.${cls}` : 'ui.class.other';

/** Catalog key of the "(being worn)" style suffix, or null for unequipped items. */
export function equippedKey(item: ViewItem): string | null {
  if (item.equipped === null) return null;
  return item.equipped === 'weapon' ? 'ui.equipped.weapon' : 'ui.equipped.worn';
}
