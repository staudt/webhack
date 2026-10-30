import type { ViewItem } from '@nh/core';
import { expect, test } from 'vitest';
import { uiMessagesEn as en } from '../src/i18n';
import { CLASS_ORDER, classKey, groupInventory } from '../src/inventory';

const item = (id: number, cls: ViewItem['cls']): ViewItem => ({
  id,
  letter: String.fromCharCode(96 + id),
  g: 'nh:x',
  cls,
  name: { key: 'x' },
  equipped: null,
});

test('classes follow NetHack order with gems after potions', () => {
  expect(CLASS_ORDER).toEqual(['coin', 'weapon', 'armor', 'food', 'scroll', 'potion', 'gem']);
  const groups = groupInventory([
    item(1, 'gem'),
    item(2, 'potion'),
    item(3, 'coin'),
    item(4, 'weapon'),
    item(5, 'scroll'),
    item(6, 'armor'),
    item(7, 'food'),
  ]);
  expect(groups.map((g) => g.cls)).toEqual([
    'coin',
    'weapon',
    'armor',
    'food',
    'scroll',
    'potion',
    'gem',
  ]);
});

test('gems get their own heading, unknown classes go last under Other', () => {
  expect(classKey('gem')).toBe('ui.class.gem');
  expect(en['ui.class.gem']).toBe('Gems/Stones');
  expect(classKey('wand')).toBe('ui.class.other');
  expect(groupInventory([item(1, 'gem'), item(2, 'weapon')]).map((g) => g.cls)).toEqual([
    'weapon',
    'gem',
  ]);
});
