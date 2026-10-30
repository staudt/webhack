import {
  addToInventory,
  calcCapacity,
  findAc,
  invWeight,
  isKnown,
  P_BASIC,
  P_UNSKILLED,
  skillLevel,
} from '../src/index';
import { getPlayer, inventoryOf, type DefId, type GameEvent } from '@nh/core';
import { describe, expect, test } from 'vitest';
import {
  defs,
  engine,
  freshState,
  invLine,
  itemOf,
  levelSetup,
  obj,
  plainKit,
  render,
} from './itemHelpers';

const hero = (s: ReturnType<typeof levelSetup>) => getPlayer(s.state);
const setAttrs = (s: ReturnType<typeof levelSetup>, str: number, con: number) => {
  const a = hero(s).c.attributes;
  if (a) Object.assign(a, { str, con });
};
const offered = (
  s: ReturnType<typeof levelSetup>,
  target: Parameters<ReturnType<typeof engine.query>['actionsFor']>[0],
) =>
  engine
    .query(s.state)
    .actionsFor(target)
    .flatMap((o) => (o.action.type === 'mod' ? [o.action.action as string] : []));

describe('the Valkyrie kit', () => {
  test('letters a-d, equipment, identification and starting AC 6', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const s = freshState(seed);
      const inv = inventoryOf(s, s.playerId);
      expect(inv.map((e) => [e.c.item?.letter, e.def])).toEqual([
        ['a', 'nh:spear'],
        ['b', 'nh:dagger'],
        ['c', 'nh:small_shield'],
        ['d', 'nh:food_ration'],
      ]);
      expect(inv.map((e) => e.c.item?.spe)).toEqual([1, 0, 3, 0]);
      expect(inv.map((e) => e.c.item?.equipped)).toEqual(['weapon', null, 'shield', null]);
      for (const e of inv) {
        expect(e.c.item?.known).toEqual({ buc: true, spe: true });
        expect(e.c.item?.quantity).toBe(1);
        expect(e.c.item?.buc).not.toBe('cursed');
      }
      expect(inv[3]?.c.item?.buc).toBe('uncursed');
      expect(s.discovered).toEqual(['nh:small_shield']);
      expect(findAc(s, defs, s.playerId)).toBe(6);
    }
  });

  test('inventory lines read as NetHack prints them', () => {
    const s = freshState(3);
    plainKit(s);
    expect(inventoryOf(s, s.playerId).map((e) => invLine(s, e))).toEqual([
      'a - an uncursed +1 spear (weapon in hand)',
      'b - an uncursed +0 dagger',
      'c - an uncursed +3 small shield (being worn)',
      'd - an uncursed food ration',
    ]);
  });

  test('starting skills: kit weapons Basic, the role list Unskilled, others restricted', () => {
    const s = levelSetup();
    const c = s.ctx;
    expect(skillLevel(c, 'spear')).toBe(P_BASIC);
    expect(skillLevel(c, 'dagger')).toBe(P_BASIC);
    expect(skillLevel(c, 'long_sword')).toBe(P_UNSKILLED);
    expect(skillLevel(c, 'axe')).toBe(P_UNSKILLED);
    expect(skillLevel(c, 'bare_handed')).toBe(P_UNSKILLED);
    expect(skillLevel(c, 'mace')).toBe(0);
  });

  test('is deterministic per seed', () => {
    const a = freshState(9);
    const b = freshState(9);
    expect(inventoryOf(a, a.playerId)).toEqual(inventoryOf(b, b.playerId));
  });
});

describe('looking at the floor', () => {
  const next = (s: ReturnType<typeof levelSetup>) => s.step({ type: 'move', dir: 'e' });

  test('nothing is said on an empty cell', () => {
    const s = levelSetup(['.@...']);
    expect(s.msgKeys(next(s))).toEqual([]);
  });

  test('one object: You see here', () => {
    const s = levelSetup(['.@...']);
    s.floor('nh:apple', { at: { level: 'dlvl1', x: 2, y: 0 } });
    expect(s.text(next(s))).toEqual(['You see here an apple.']);
    const s2 = levelSetup(['.@...']);
    s2.floor('nh:dagger', { at: { level: 'dlvl1', x: 2, y: 0 }, quantity: 3 });
    expect(s2.text(next(s2))).toEqual(['You see here 3 daggers.']);
  });

  test('two to four objects: a list; five or more: several / many', () => {
    const s = levelSetup(['.@...']);
    const at = { level: 'dlvl1', x: 2, y: 0 };
    s.floor('nh:apple', { at });
    s.floor('nh:carrot', { at });
    const r = next(s);
    const ev = r.events.find((e): e is Extract<GameEvent, { type: 'list' }> => e.type === 'list');
    expect(ev?.titleKey).toBe('look.things');
    expect(ev?.items.map((m) => render(m)).sort()).toEqual(['an apple', 'a carrot'].sort());
    expect(ev?.items).toHaveLength(2);
    const five = levelSetup(['.@...']);
    for (const id of ['nh:apple', 'nh:carrot', 'nh:knife', 'nh:club', 'nh:axe'])
      five.floor(id, { at });
    expect(five.msgKeys(next(five))).toEqual(['look.several']);
    const ten = levelSetup(['.@...']);
    const kinds = [
      'nh:apple',
      'nh:carrot',
      'nh:knife',
      'nh:club',
      'nh:axe',
      'nh:mace',
      'nh:spear',
      'nh:scimitar',
      'nh:long_sword',
      'nh:dagger',
    ];
    for (const id of kinds) ten.floor(id, { at });
    expect(ten.msgKeys(next(ten))).toEqual(['look.many']);
    expect(render({ key: 'look.several' })).toBe('There are several objects here.');
  });

  test('travel stops on a cell with objects', () => {
    const s = levelSetup(['@......']);
    s.floor('nh:apple', { at: { level: 'dlvl1', x: 3, y: 0 } });
    s.step({ type: 'wait' }); // see the map first: travel goes over remembered cells
    s.mod('nh:travel', { x: 6, y: 0 });
    expect(hero(s).c.pos?.x).toBe(3);
    expect(s.text(s.step({ type: 'wait' }))).toEqual([]);
  });
});

/** A dagger with its own enchantment, so it never merges into another stack. */
function addDistinctDagger(s: ReturnType<typeof levelSetup>, spe: number): void {
  const id = s.give('nh:dagger');
  itemOf(s.state, id).spe = spe;
  addToInventory(s.ctx, s.state.playerId, id);
}

describe('pick up', () => {
  test('is offered on self only when there are objects here', () => {
    const s = levelSetup();
    expect(offered(s, { kind: 'self' })).not.toContain('nh:pickup');
    s.floor('nh:apple');
    expect(offered(s, { kind: 'self' })).toContain('nh:pickup');
    expect(
      engine
        .query(s.state)
        .actionsFor({ kind: 'self' })
        .find((o) => o.labelKey === 'action.nh:pickup'),
    ).toBeDefined();
  });

  test('nothing here: a message and no time', () => {
    const s = levelSetup();
    const t0 = s.state.turn;
    expect(s.msgKeys(s.mod('nh:pickup'))).toEqual(['pickup.nothing']);
    expect(s.state.turn).toBe(t0);
  });

  test('one object is taken directly with the next free letter, costing a move', () => {
    const s = levelSetup();
    const t0 = s.state.turn;
    const id = s.floor('nh:apple');
    const r = s.mod('nh:pickup');
    expect(r.prompt).toBeNull();
    expect(s.text(r)).toEqual(['e - an apple.']);
    expect(s.letterOf(id)).toBe('e');
    expect(itemOf(s.state, id).carriedBy).toBe(s.state.playerId);
    expect(s.state.entities[String(id)]?.c.pos).toBeUndefined();
    expect(s.state.turn).toBe(t0 + 1);
  });

  test('several objects raise a multi menu; the answer picks some, empty picks none', () => {
    const s = levelSetup();
    const apple = s.floor('nh:apple');
    const carrot = s.floor('nh:carrot');
    const t0 = s.state.turn;
    const r = s.mod('nh:pickup');
    expect(r.prompt?.kind).toBe('menu');
    expect(r.prompt?.multi).toBe(true);
    expect(r.prompt?.options?.map((o) => o.value)).toEqual([carrot, apple]); // top of the pile first
    expect(r.prompt?.options?.every((o) => o.glyph !== undefined)).toBe(true);
    expect(
      r.prompt?.options?.map((o) =>
        render({ key: o.key, ...(o.params ? { params: o.params } : {}) }),
      ),
    ).toEqual(['a carrot', 'an apple']);
    expect(s.state.turn).toBe(t0); // nothing happens until it is answered
    const a = s.step({ type: 'answer', promptId: 'pickup-menu', value: [] });
    expect(s.msgKeys(a)).toEqual([]);
    expect(s.state.turn).toBe(t0);
    expect(itemOf(s.state, apple).carriedBy).toBeNull();

    const r2 = s.mod('nh:pickup');
    const a2 = s.step({ type: 'answer', promptId: r2.prompt?.id ?? '', value: [apple] });
    expect(s.text(a2)).toEqual(['e - an apple.']);
    expect(s.state.turn).toBe(t0 + 1);
    expect(itemOf(s.state, carrot).carriedBy).toBeNull();

    const r3 = s.mod('nh:pickup');
    expect(r3.prompt).toBeNull(); // only the carrot is left: taken without a menu
    expect(s.text(r3)).toEqual(['f - a carrot.']);
  });

  test('all of several with one answer', () => {
    const s = levelSetup();
    s.floor('nh:apple');
    s.floor('nh:carrot');
    const r = s.mod('nh:pickup');
    const ids = r.prompt?.options?.map((o) => o.value) ?? [];
    const a = s.step({ type: 'answer', promptId: 'pickup-menu', value: ids });
    expect(s.text(a)).toEqual(['e - a carrot.', 'f - an apple.']);
  });

  test('merging prints the total; gold reads like NetHack 5.0', () => {
    const s = levelSetup();
    s.floor('nh:gold_piece', { quantity: 25 });
    expect(s.text(s.mod('nh:pickup'))).toEqual(['$ - 25 gold pieces.']);
    s.floor('nh:gold_piece', { quantity: 10 });
    expect(s.text(s.mod('nh:pickup'))).toEqual(['$ - 10 gold pieces (35 in total).']);
    expect(s.state.entities[String(s.byLetter('$'))]?.c.item?.quantity).toBe(35);
    s.floor('nh:food_ration', { quantity: 2 });
    plainKit(s.state);
    itemOf(s.state, s.byLetter('d')).buc = 'uncursed';
    const r = s.text(s.mod('nh:pickup'));
    // the floor ration's unknown BUC meets the kit's known one: comparing teaches the hero
    expect(r).toEqual([
      'You learn more about your items by comparing them.',
      'd - 2 uncursed food rations (3 in total).',
    ]);
  });

  test('a lifted item keeps the letter it had when dropped', () => {
    const s = levelSetup();
    plainKit(s.state);
    s.mod('nh:drop', { item: s.byLetter('b') });
    s.carry('nh:knife');
    expect(s.text(s.mod('nh:pickup'))).toEqual(['b - an uncursed +0 dagger.']);
  });

  test('weight limit: only some can be lifted, and a heavy load asks first', () => {
    const s = levelSetup();
    setAttrs(s, 3, 3); // capacity 200; the kit weighs 90
    const kit = invWeight(s.state, defs, s.state.playerId) + 200;
    expect(kit).toBe(90);
    s.floor('nh:knife', { quantity: 400 }); // 2000 weight
    const r = s.mod('nh:pickup');
    // 101 knives fit under the overload limit; lifting them Strains her: confirm first
    expect(s.msgKeys(r)).toEqual(['pickup.only_some']);
    expect(r.prompt?.kind).toBe('yn');
    expect(r.prompt?.key).toBe('pickup.confirm');
    expect(calcCapacity(s.state, defs, s.state.playerId, 505)).toBe(4); // Overtaxed
    const no = s.step({ type: 'answer', promptId: 'pickup-confirm', value: false });
    expect(s.msgKeys(no)).toEqual([]);
    expect(inventoryOf(s.state, s.state.playerId)).toHaveLength(4);

    const again = s.mod('nh:pickup');
    const yes = s.step({ type: 'answer', promptId: again.prompt?.id ?? '', value: true });
    const txt = s.text(yes);
    expect(txt[0]).toBe('You have extreme difficulty lifting e - 101 knives.');
    expect(s.msgKeys(yes)).toContain('encumber.up.4');
    expect(s.state.entities[String(s.byLetter('e'))]?.c.item?.quantity).toBe(101);
  });

  test('nothing can be lifted: "cannot lift any more" / "too heavy"', () => {
    const s = levelSetup();
    setAttrs(s, 3, 3);
    s.carry('nh:knife', { quantity: 120 }); // 600: right at the overload limit
    s.floor('nh:apple');
    expect(s.text(s.mod('nh:pickup'))[0]).toBe(
      'There is an apple here, but you cannot lift any more.',
    );
    expect(inventoryOf(s.state, s.state.playerId).some((e) => e.def === 'nh:apple')).toBe(false);

    const t = levelSetup();
    setAttrs(t, 3, 3);
    for (const e of inventoryOf(t.state, t.state.playerId)) t.ctx.remove(e.id);
    t.floor('nh:dagger', { quantity: 1000 });
    expect(t.text(t.mod('nh:pickup'))[0]).toMatch(/^You can only lift some of the/);
  });

  test('the knapsack holds 52 stacks; gold is exempt', () => {
    const s = levelSetup();
    setAttrs(s, 25, 25);
    for (let i = 0; i < 48; i++) addDistinctDagger(s, i + 1);
    expect(inventoryOf(s.state, s.state.playerId)).toHaveLength(52);
    s.floor('nh:apple');
    const t0 = s.state.turn;
    expect(s.msgKeys(s.mod('nh:pickup'))).toEqual(['pickup.full']);
    expect(s.state.turn).toBe(t0);
    // gold needs no letter
    const g = levelSetup();
    setAttrs(g, 25, 25);
    for (let i = 0; i < 48; i++) addDistinctDagger(g, i + 1);
    g.floor('nh:gold_piece', { quantity: 7 });
    expect(g.text(g.mod('nh:pickup'))).toEqual(['$ - 7 gold pieces.']);
  });
});

describe('drop', () => {
  test('is offered for every carried item and drops it on the floor, costing a move', () => {
    const s = levelSetup();
    plainKit(s.state);
    for (const e of inventoryOf(s.state, s.state.playerId))
      expect(offered(s, { kind: 'item', id: e.id })).toContain('nh:drop');
    const t0 = s.state.turn;
    const dagger = s.byLetter('b');
    const r = s.mod('nh:drop', { item: dagger });
    expect(s.text(r)).toEqual(['You drop an uncursed +0 dagger.']);
    expect(itemOf(s.state, dagger)).toMatchObject({ carriedBy: null, letter: 'b' });
    expect(s.state.entities[String(dagger)]?.c.pos).toMatchObject({ x: s.here.x, y: s.here.y });
    expect(s.state.turn).toBe(t0 + 1);
    expect(offered(s, { kind: 'item', id: dagger })).toEqual([]); // no longer carried
  });

  test('a wielded weapon is unwielded when dropped; worn armor cannot be dropped', () => {
    const s = levelSetup();
    plainKit(s.state);
    const spear = s.byLetter('a');
    expect(s.text(s.mod('nh:drop', { item: spear }))).toEqual(['You drop an uncursed +1 spear.']);
    expect(itemOf(s.state, spear).equipped).toBeNull();
    const shield = s.byLetter('c');
    const t0 = s.state.turn;
    expect(s.text(s.mod('nh:drop', { item: shield }))).toEqual([
      'You cannot drop something you are wearing.',
    ]);
    expect(s.state.turn).toBe(t0);
    expect(itemOf(s.state, shield).carriedBy).toBe(s.state.playerId);
  });

  test('a cursed wielded weapon is welded and cannot be dropped', () => {
    const s = levelSetup();
    const spear = s.byLetter('a');
    itemOf(s.state, spear).buc = 'cursed';
    itemOf(s.state, spear).known.buc = false;
    expect(s.text(s.mod('nh:drop', { item: spear }))).toEqual([
      'You cannot drop something welded to your hand.',
    ]);
    expect(itemOf(s.state, spear)).toMatchObject({
      equipped: 'weapon',
      carriedBy: s.state.playerId,
    });
    expect(itemOf(s.state, spear).known.buc).toBe(true);
  });

  test('drop several: a menu of the inventory with letters; each chosen item is dropped', () => {
    const s = levelSetup();
    plainKit(s.state);
    expect(offered(s, { kind: 'self' })).toContain('nh:drop_many');
    const r = s.mod('nh:drop_many');
    expect(r.prompt?.kind).toBe('menu');
    expect(r.prompt?.multi).toBe(true);
    expect(r.prompt?.options).toHaveLength(4);
    const first = r.prompt?.options?.[0];
    expect(
      render({ key: first?.key ?? '', ...(first?.params ? { params: first.params } : {}) }),
    ).toBe('a - an uncursed +1 spear (weapon in hand)');
    const t0 = s.state.turn;
    const none = s.step({ type: 'answer', promptId: 'drop-menu', value: [] });
    expect(s.msgKeys(none)).toEqual([]);
    expect(s.state.turn).toBe(t0);
    const r2 = s.mod('nh:drop_many');
    const ids = [s.byLetter('b'), s.byLetter('d'), s.byLetter('c')];
    const a = s.step({ type: 'answer', promptId: r2.prompt?.id ?? '', value: ids });
    expect(s.text(a)).toEqual([
      'You drop an uncursed +0 dagger.',
      'You drop an uncursed food ration.',
      'You cannot drop something you are wearing.',
    ]);
    expect(s.state.turn).toBe(t0 + 1);
    expect(inventoryOf(s.state, s.state.playerId)).toHaveLength(2);
  });

  test('drop several is not offered with an empty inventory', () => {
    const s = levelSetup();
    for (const e of inventoryOf(s.state, s.state.playerId)) s.ctx.remove(e.id);
    expect(offered(s, { kind: 'self' })).not.toContain('nh:drop_many');
  });
});

describe('wield', () => {
  test('offers: weapons not wielded, and "wield nothing" on the wielded one', () => {
    const s = levelSetup();
    const spear = s.byLetter('a');
    const dagger = s.byLetter('b');
    const labels = (id: number) =>
      engine
        .query(s.state)
        .actionsFor({ kind: 'item', id })
        .map((o) => o.labelKey);
    expect(labels(dagger)).toContain('action.nh:wield');
    expect(labels(spear)).toContain('action.nh:wield_nothing');
    expect(labels(spear)).not.toContain('action.nh:wield');
    expect(labels(s.byLetter('d'))).not.toContain('action.nh:wield'); // food
    expect(labels(s.byLetter('c'))).not.toContain('action.nh:wield'); // armor
    const nothing = engine
      .query(s.state)
      .actionsFor({ kind: 'item', id: spear })
      .find((o) => o.labelKey === 'action.nh:wield_nothing');
    expect(nothing?.action).toEqual({ type: 'mod', action: 'nh:wield', args: { item: null } });
  });

  test('wielding another weapon swaps, prints the line and costs a move', () => {
    const s = levelSetup();
    plainKit(s.state);
    const t0 = s.state.turn;
    const r = s.mod('nh:wield', { item: s.byLetter('b') });
    expect(s.text(r)).toEqual(['b - an uncursed +0 dagger (weapon in hand).']);
    expect(itemOf(s.state, s.byLetter('a')).equipped).toBeNull();
    expect(itemOf(s.state, s.byLetter('b')).equipped).toBe('weapon');
    expect(s.state.turn).toBe(t0 + 1);
  });

  test('wield nothing: bare handed, then already bare handed for free', () => {
    const s = levelSetup();
    const t0 = s.state.turn;
    expect(s.text(s.mod('nh:wield', { item: null }))).toEqual(['You are bare handed.']);
    expect(s.state.turn).toBe(t0 + 1);
    expect(s.text(s.mod('nh:wield', { item: null }))).toEqual(['You are already bare handed.']);
    expect(s.state.turn).toBe(t0 + 1);
  });

  test('a two-handed weapon cannot be wielded with a shield on', () => {
    const s = levelSetup();
    const m = s.carry('nh:dwarvish_mattock');
    const t0 = s.state.turn;
    expect(s.text(s.mod('nh:wield', { item: m }))).toEqual([
      'You cannot wield a two-handed weapon while wearing a shield.',
    ]);
    expect(s.state.turn).toBe(t0);
    s.mod('nh:takeoff', { item: s.byLetter('c') });
    discoverMattock(s);
    expect(s.text(s.mod('nh:wield', { item: m }))[0]).toMatch(/\(weapon in hands\)\.$/);
  });

  test('a two-handed sword says "sword"', () => {
    const s = levelSetup();
    const m = s.carry('nh:long_sword');
    // long swords are one-handed; only bimanual weapons are refused
    expect(s.text(s.mod('nh:wield', { item: m }))[0]).toMatch(/long sword \(weapon in hand\)\.$/);
  });

  test('a cursed weapon welds; nothing else can be wielded or dropped then', () => {
    const s = levelSetup();
    const mace = s.carry('nh:mace', { init: false });
    itemOf(s.state, mace).buc = 'cursed';
    const r = s.mod('nh:wield', { item: mace });
    expect(s.text(r)).toEqual(['The mace welds itself to your dominant right hand!']);
    expect(itemOf(s.state, mace)).toMatchObject({ equipped: 'weapon' });
    expect(itemOf(s.state, mace).known.buc).toBe(true);
    const t0 = s.state.turn;
    expect(s.text(s.mod('nh:wield', { item: s.byLetter('b') }))).toEqual([
      'Your mace is welded to your hand!',
    ]);
    expect(s.text(s.mod('nh:wield', { item: null }))).toEqual([
      'Your mace is welded to your hand!',
    ]);
    expect(s.state.turn).toBe(t0);
    // no "wield nothing" offer once the curse is known
    expect(
      engine
        .query(s.state)
        .actionsFor({ kind: 'item', id: mace })
        .map((o) => o.labelKey),
    ).not.toContain('action.nh:wield_nothing');
  });

  test('wielding a stack that is cursed uses the plural', () => {
    const s = levelSetup();
    const k = s.carry('nh:knife', { quantity: 3 });
    itemOf(s.state, k).buc = 'cursed';
    expect(s.text(s.mod('nh:wield', { item: k }))).toEqual([
      'The knives weld themselves to your dominant right hand!',
    ]);
  });
});

function discoverMattock(s: ReturnType<typeof levelSetup>) {
  s.state.discovered.push('nh:dwarvish_mattock' as DefId);
}

describe('wear and take off', () => {
  test('take off the shield (no delay) and wear it again; AC follows at once', () => {
    const s = levelSetup();
    plainKit(s.state);
    const shield = s.byLetter('c');
    const t0 = s.state.turn;
    expect(
      engine
        .query(s.state)
        .actionsFor({ kind: 'item', id: shield })
        .map((o) => o.labelKey),
    ).toEqual(['action.nh:drop', 'action.nh:takeoff']);
    expect(s.text(s.mod('nh:takeoff', { item: shield }))).toEqual([
      'You were wearing an uncursed +3 small shield.',
    ]);
    expect(s.state.turn).toBe(t0 + 1);
    expect(findAc(s.state, defs, s.state.playerId)).toBe(10);
    expect(
      engine
        .query(s.state)
        .actionsFor({ kind: 'item', id: shield })
        .map((o) => o.labelKey),
    ).toEqual(['action.nh:drop', 'action.nh:wear']);
    expect(s.text(s.mod('nh:wear', { item: shield }))).toEqual([
      'You are now wearing a small shield.',
    ]);
    expect(findAc(s.state, defs, s.state.playerId)).toBe(6);
    expect(s.state.turn).toBe(t0 + 2);
    expect(hero(s).c.helpless).toBeUndefined();
  });

  test('armor with a delay keeps her busy while monsters act; AC is immediate', () => {
    const s = levelSetup();
    const mail = s.carry('nh:ring_mail');
    // a jackal next to her attacks every turn she is busy
    const jackal = s.state.nextEntityId++;
    s.state.entities[String(jackal)] = {
      id: jackal,
      def: 'nh:jackal',
      c: {
        pos: { level: 'dlvl1', x: s.here.x + 1, y: s.here.y },
        actor: { energy: 0, speed: 12 },
        hp: { cur: 5, max: 5 },
        monster: { level: 0, peaceful: false, asleep: false, lastHero: null },
      },
    };
    const delay = defs.object('nh:ring_mail').delay;
    expect(delay).toBe(5);
    const t0 = s.state.turn;
    const r = s.mod('nh:wear', { item: mail });
    expect(s.state.turn).toBe(t0 + 1 + delay);
    expect(findAc(s.state, defs, s.state.playerId)).toBe(6 - defs.object('nh:ring_mail').armor!.ac);
    const attacks = s.msgKeys(r).filter((k) => k.startsWith('combat.mon_'));
    expect(attacks.length).toBeGreaterThanOrEqual(4); // acts on each of the busy turns
    expect(s.msgKeys(r)).toContain('wear.finish');
    expect(s.msgKeys(r)).not.toContain('wear.now');
    expect(hero(s).c.helpless).toBeUndefined();
    expect(itemOf(s.state, mail).equipped).toBe('body');
    expect(itemOf(s.state, mail).known.spe).toBe(true);

    // taking it off takes time too
    const t1 = s.state.turn;
    const off = s.mod('nh:takeoff', { item: mail });
    expect(s.state.turn).toBe(t1 + 1 + delay);
    expect(s.msgKeys(off)).toContain('takeoff.finish');
    expect(findAc(s.state, defs, s.state.playerId)).toBe(6);
  });

  test("slot conflicts print NetHack's messages and cost nothing", () => {
    const s = levelSetup();
    const cloak = s.carry('nh:dwarvish_cloak');
    const mail = s.carry('nh:ring_mail');
    const helm = s.carry('nh:orcish_helm');
    const helm2 = s.carry('nh:dwarvish_iron_helm');
    const shield2 = s.carry('nh:dwarvish_roundshield');
    const t0 = s.state.turn;
    s.mod('nh:wear', { item: helm });
    expect(s.text(s.mod('nh:wear', { item: helm2 }))).toEqual(['You are already wearing a helm.']);
    expect(s.text(s.mod('nh:wear', { item: shield2 }))).toEqual([
      'You are already wearing a shield.',
    ]);
    s.mod('nh:wear', { item: cloak });
    expect(s.text(s.mod('nh:wear', { item: mail }))).toEqual([
      'You cannot wear armor over a cloak.',
    ]);
    expect(s.text(s.mod('nh:wear', { item: cloak }))).toEqual(['You are already wearing that!']);
    // not offered when it cannot be worn
    const labels = (id: number) =>
      engine
        .query(s.state)
        .actionsFor({ kind: 'item', id })
        .map((o) => o.labelKey);
    expect(labels(mail)).not.toContain('action.nh:wear');
    expect(labels(helm2)).not.toContain('action.nh:wear');
    void t0;
  });

  test('a shield cannot be worn with a two-handed weapon wielded', () => {
    const s = levelSetup();
    s.mod('nh:takeoff', { item: s.byLetter('c') });
    const mattock = s.carry('nh:dwarvish_mattock');
    s.mod('nh:wield', { item: mattock });
    const t0 = s.state.turn;
    expect(s.text(s.mod('nh:wear', { item: s.byLetter('c') }))).toEqual([
      'You cannot wear a shield while wielding a two-handed weapon.',
    ]);
    expect(s.state.turn).toBe(t0);
    expect(
      engine
        .query(s.state)
        .actionsFor({ kind: 'item', id: s.byLetter('c') })
        .map((o) => o.labelKey),
    ).not.toContain('action.nh:wear');
  });

  test('a suit cannot be removed under a cloak, or a shirt under a suit', () => {
    const s = levelSetup();
    const mail = s.carry('nh:ring_mail', { init: false });
    itemOf(s.state, mail).equipped = 'body';
    const cloak = s.carry('nh:dwarvish_cloak');
    itemOf(s.state, cloak).equipped = 'cloak';
    const t0 = s.state.turn;
    expect(s.text(s.mod('nh:takeoff', { item: mail }))).toEqual([
      "You can't take that off without taking off your cloak first.",
    ]);
    expect(s.state.turn).toBe(t0);
    expect(
      engine
        .query(s.state)
        .actionsFor({ kind: 'item', id: mail })
        .map((o) => o.labelKey),
    ).not.toContain('action.nh:takeoff');
  });

  test('cursed armor stays on and the curse becomes known', () => {
    const s = levelSetup();
    const helm = s.carry('nh:orcish_helm');
    itemOf(s.state, helm).buc = 'cursed';
    itemOf(s.state, helm).equipped = 'helm';
    const t0 = s.state.turn;
    expect(s.text(s.mod('nh:takeoff', { item: helm }))).toEqual(["You can't.  It is cursed."]);
    expect(itemOf(s.state, helm)).toMatchObject({ equipped: 'helm' });
    expect(itemOf(s.state, helm).known.buc).toBe(true);
    expect(s.state.turn).toBe(t0);
    const gloves = s.carry('nh:leather_gloves');
    itemOf(s.state, gloves).buc = 'cursed';
    itemOf(s.state, gloves).equipped = 'gloves';
    expect(s.text(s.mod('nh:takeoff', { item: gloves }))).toEqual(["You can't.  They are cursed."]);
  });

  test('a cursed cloak keeps the suit on', () => {
    const s = levelSetup();
    const mail = s.carry('nh:ring_mail');
    itemOf(s.state, mail).equipped = 'body';
    // cloak removed first would be needed; with a cursed cloak the suit stays
    const cloak = s.carry('nh:dwarvish_cloak');
    itemOf(s.state, cloak).equipped = 'cloak';
    itemOf(s.state, cloak).buc = 'cursed';
    expect(s.text(s.mod('nh:takeoff', { item: cloak }))).toEqual(["You can't.  It is cursed."]);
  });

  test('gloves cannot go on over a welded weapon', () => {
    const s = levelSetup();
    const mace = s.carry('nh:mace');
    itemOf(s.state, mace).buc = 'cursed';
    s.mod('nh:wield', { item: mace });
    const gloves = s.carry('nh:leather_gloves');
    expect(s.text(s.mod('nh:wear', { item: gloves }))).toEqual([
      'You cannot wear gloves over your weapon.',
    ]);
  });

  test('armor not worn: take off says so', () => {
    const s = levelSetup();
    expect(s.text(s.mod('nh:takeoff', { item: s.byLetter('b') }))).toEqual([
      'You are not wearing that.',
    ]);
  });
});

describe('combat with real objects', () => {
  const bigMon = (s: ReturnType<typeof levelSetup>, def: string, hp = 100000) => {
    const id = s.state.nextEntityId++;
    s.state.entities[String(id)] = {
      id,
      def: def as DefId,
      c: {
        pos: { level: 'dlvl1', x: s.here.x + 1, y: s.here.y },
        actor: { energy: 0, speed: 0 },
        hp: { cur: hp, max: hp },
        monster: { level: 1, peaceful: true, asleep: true, lastHero: null },
      },
    };
    return id;
  };
  /** Damage dealt by each hit over many attacks. */
  const damages = (s: ReturnType<typeof levelSetup>, def: string, n = 300): number[] => {
    const m = bigMon(s, def);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const mon = s.state.entities[String(m)];
      if (!mon?.c.hp || !mon.c.monster) break;
      mon.c.monster.asleep = true;
      mon.c.monster.peaceful = true;
      const before = mon.c.hp.cur;
      s.step({ type: 'move', dir: 'e' });
      const d = before - mon.c.hp.cur;
      if (d > 0) out.push(d);
      mon.c.hp.cur = 100000;
      if (hero(s).c.hp) hero(s).c.hp = { cur: 500, max: 500 };
    }
    return out;
  };

  test('the wielded +1 spear: d8+1 against large (Basic, Str 10)', () => {
    const s = levelSetup(['..@..'], 5);
    setAttrs(s, 10, 10);
    const d = damages(s, 'nh:rothe');
    expect(d.length).toBeGreaterThan(50);
    expect(Math.min(...d)).toBe(2);
    expect(Math.max(...d)).toBe(9);
  });

  test('bare hands: rnd(2) plus nothing at Unskilled', () => {
    const s = levelSetup(['..@..'], 5);
    setAttrs(s, 10, 10);
    s.mod('nh:wield', { item: null });
    const d = damages(s, 'nh:rothe');
    expect(d.length).toBeGreaterThan(50);
    expect([...new Set(d)].sort()).toEqual([1, 2]);
  });

  test('a restricted/unskilled two-hander: -2 damage and never below 1', () => {
    const s = levelSetup(['..@..'], 5);
    setAttrs(s, 10, 10);
    s.mod('nh:takeoff', { item: s.byLetter('c') });
    const m = s.carry('nh:dwarvish_mattock');
    s.mod('nh:wield', { item: m });
    const d = damages(s, 'nh:rothe');
    expect(d.length).toBeGreaterThan(30);
    expect(Math.min(...d)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...d)).toBeLessThanOrEqual(8 + 12 - 2);
    expect(Math.max(...d)).toBeGreaterThan(9); // 3d... can exceed a spear's maximum
  });

  test('wielding food does no damage; an iron non-weapon does some by weight', () => {
    const s = levelSetup(['..@..'], 5);
    const ration = s.byLetter('d');
    itemOf(s.state, ration).equipped = 'weapon';
    itemOf(s.state, s.byLetter('a')).equipped = null;
    expect(damages(s, 'nh:rothe', 100)).toEqual([]);
  });

  test('monsters roll against the AC from worn armor', () => {
    const rate = (shield: boolean) => {
      const s = levelSetup(['.@.'], 21);
      if (!shield) s.mod('nh:takeoff', { item: s.byLetter('c') });
      const id = s.state.nextEntityId++;
      s.state.entities[String(id)] = {
        id,
        def: 'nh:jackal',
        c: {
          pos: { level: 'dlvl1', x: 2, y: 0 },
          actor: { energy: 0, speed: 12 },
          hp: { cur: 5, max: 5 },
          monster: { level: 0, peaceful: false, asleep: false, lastHero: null },
        },
      };
      let hits = 0;
      let swings = 0;
      for (let i = 0; i < 400; i++) {
        const hp = hero(s).c.hp;
        if (hp) hp.cur = hp.max = 5000;
        const r = s.step({ type: 'wait' });
        for (const k of s.msgKeys(r)) {
          if (k.startsWith('combat.mon_')) swings++;
          if (k === 'combat.mon_bites') hits++;
        }
      }
      return hits / swings;
    };
    const armored = rate(true); // AC 6: tmp 16 -> 75%
    const bare = rate(false); // AC 10: tmp 20 -> 95%
    expect(bare).toBeGreaterThan(armored + 0.1);
    expect(armored).toBeGreaterThan(0.65);
    expect(armored).toBeLessThan(0.85);
  });
});

describe('discoveries', () => {
  test('lists identified types that have a description, by class', () => {
    const s = levelSetup();
    const r = s.mod('nh:discoveries');
    const ev = r.events.find((e): e is Extract<GameEvent, { type: 'list' }> => e.type === 'list');
    expect(ev?.titleKey).toBe('disco.title');
    expect(ev?.items.map((m) => render(m))).toEqual(['Armor', '  small shield (wooden shield)']);
  });

  test('costs no time; scrolls and potions show their appearance; none says so', () => {
    const s = levelSetup();
    const t0 = s.state.turn;
    s.state.discovered.push('nh:scroll_of_identify' as DefId, 'nh:potion_of_healing' as DefId);
    s.state.discovered.sort();
    const r = s.mod('nh:discoveries');
    expect(s.state.turn).toBe(t0);
    const ev = r.events.find((e): e is Extract<GameEvent, { type: 'list' }> => e.type === 'list');
    const text = ev?.items.map((m) => render(m)) ?? [];
    expect(text.slice(0, 2)).toEqual(['Armor', '  small shield (wooden shield)']);
    expect(text).toContain('Scrolls');
    expect(text).toContain('Potions');
    expect(text.some((l) => /^ {2}scroll of identify \(scroll labeled [A-Z _]+\)$/.test(l))).toBe(
      true,
    );
    expect(text.some((l) => /^ {2}potion of healing \(.* potion\)$/.test(l))).toBe(true);
    s.state.discovered.length = 0;
    expect(s.msgKeys(s.mod('nh:discoveries'))).toEqual(['disco.none']);
    expect(isKnown(s.state, defs, obj('nh:small_shield'))).toBe(false);
  });
});

describe('discoverability', () => {
  test('every item action comes from actionsFor', () => {
    const s = levelSetup();
    s.floor('nh:apple');
    const ids = new Set<string>();
    for (const t of [
      { kind: 'self' } as const,
      ...inventoryOf(s.state, s.state.playerId).map((e) => ({ kind: 'item', id: e.id }) as const),
    ]) {
      for (const o of engine.query(s.state).actionsFor(t)) {
        if (o.action.type === 'mod') ids.add(o.action.action);
      }
    }
    s.carry('nh:ring_mail');
    for (const e of inventoryOf(s.state, s.state.playerId))
      for (const o of engine.query(s.state).actionsFor({ kind: 'item', id: e.id }))
        if (o.action.type === 'mod') ids.add(o.action.action);
    for (const id of [
      'nh:pickup',
      'nh:drop',
      'nh:drop_many',
      'nh:wield',
      'nh:wear',
      'nh:takeoff',
      'nh:discoveries',
    ])
      expect(ids.has(id), id).toBe(true);
    // all labels exist in the catalog
    for (const t of [{ kind: 'self' } as const])
      for (const o of engine.query(s.state).actionsFor(t))
        expect(render({ key: o.labelKey })).toBeTypeOf('string');
  });

  test("items that are not the hero's offer nothing", () => {
    const s = levelSetup();
    const id = s.floor('nh:dagger');
    expect(engine.query(s.state).actionsFor({ kind: 'item', id })).toEqual([]);
  });
});
