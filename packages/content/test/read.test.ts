import { getPlayer, inventoryOf, type Buc, type EntityId } from '@nh/core';
import { describe, expect, test } from 'vitest';
import { isKnown, nhData } from '../src/index';
import { defs, engine, levelSetup, plainKit } from './itemHelpers';

type Setup = ReturnType<typeof levelSetup>;

function make(s: Setup, def: string, buc: Buc, extra: { quantity?: number; spe?: number } = {}) {
  const id = s.carry(def, { quantity: extra.quantity ?? 1 });
  const it = s.state.entities[String(id)]?.c.item;
  if (!it) throw new Error('no item');
  it.buc = buc;
  if (extra.spe !== undefined) it.spe = extra.spe;
  return id;
}
const read = (s: Setup, id: EntityId) => s.mod('nh:read', { item: id });
const item = (s: Setup, id: EntityId) => s.state.entities[String(id)]?.c.item;
const spear = (s: Setup) => s.byLetter('a');
const shield = (s: Setup) => s.byLetter('c');

describe('scroll of identify', () => {
  test('reading an unknown identify scroll names it and offers a menu for one item', () => {
    // uncursed: 4 in 5 identify one item
    let menus = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = levelSetup(undefined, seed);
      plainKit(s.state);
      const p1 = s.carry('nh:potion_of_healing');
      const p2 = s.carry('nh:potion_of_water');
      const p3 = s.carry('nh:potion_of_see_invisible');
      const scroll = make(s, 'nh:scroll_of_identify', 'uncursed');
      const turn = s.state.turn;
      const r = read(s, scroll);
      const text = s.text(r);
      expect(text[0]).toBe('As you read the scroll, it disappears.');
      expect(text[1]).toBe('This is an identify scroll.');
      expect(isKnown(s.state, defs, 'nh:scroll_of_identify')).toBe(true);
      expect(s.state.entities[String(scroll)]).toBeUndefined();
      const prompt = s.state.pendingPrompt?.prompt;
      if (!prompt) continue; // identified all or "everything"
      menus++;
      expect(s.state.turn).toBe(turn); // the move is spent on the answer
      expect(prompt.kind).toBe('menu');
      expect(prompt.multi).toBe(true);
      expect(prompt.key).toBe('identify.what_first');
      // only unidentified items are offered: the three potions (the kit is fully known)
      expect(prompt.options?.map((o) => o.value)).toEqual([p1, p2, p3]);
      const a = engine.step(s.state, { type: 'answer', promptId: prompt.id, value: [p2, p3] });
      // limit 1: only the first chosen is identified
      expect(item(s, p2)?.known).toEqual({ buc: true, spe: true });
      expect(item(s, p3)?.known.buc).toBe(false);
      expect(isKnown(s.state, defs, 'nh:potion_of_water')).toBe(true);
      expect(s.state.turn).toBe(turn + 1);
      expect(s.text(a)[0]).toMatch(/^[a-z] - .*water/);
      expect(s.state.pendingPrompt).toBeNull();
    }
    expect(menus).toBeGreaterThan(10);
  });

  test('a blessed scroll identifies several; 0 means everything', () => {
    const counts = new Set<number>();
    let everything = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = levelSetup(undefined, seed);
      plainKit(s.state);
      const ids = [
        'nh:potion_of_healing',
        'nh:potion_of_water',
        'nh:potion_of_see_invisible',
        'nh:potion_of_extra_healing',
        'nh:scroll_of_light',
      ].map((d) => s.carry(d));
      read(s, make(s, 'nh:scroll_of_identify', 'blessed'));
      for (let guard = 0; s.state.pendingPrompt && guard < 6; guard++) {
        const prompt = s.state.pendingPrompt.prompt;
        const first = prompt.options?.[0]?.value;
        if (typeof first !== 'number') break;
        // choose everything offered: only `limit` of them take effect
        engine.step(s.state, {
          type: 'answer',
          promptId: prompt.id,
          value: (prompt.options ?? []).map((o) => o.value),
        });
      }
      const done = ids.filter((id) => item(s, id)?.known.buc).length;
      counts.add(done);
      if (done === ids.length) everything++;
      expect(done).toBeGreaterThan(0);
    }
    expect(everything).toBeGreaterThan(0);
    expect(counts.size).toBeGreaterThan(2);
  });

  test('a cursed unknown identify scroll only identifies itself', () => {
    const s = levelSetup();
    const p = s.carry('nh:potion_of_healing');
    const r = read(s, make(s, 'nh:scroll_of_identify', 'cursed'));
    expect(s.text(r)).toEqual([
      'As you read the scroll, it disappears.',
      'You identify this as an identify scroll.',
    ]);
    expect(s.state.pendingPrompt).toBeNull();
    expect(item(s, p)?.known.buc).toBe(false);
    expect(isKnown(s.state, defs, 'nh:scroll_of_identify')).toBe(true);
  });

  test('nothing to identify, and the "rest" wording', () => {
    const s = levelSetup();
    // the kit is fully identified
    const r = read(s, make(s, 'nh:scroll_of_identify', 'blessed'));
    expect(s.text(r)).toContain('You have already identified the rest of your possessions.');
    // known scroll type: "all"
    const r2 = read(s, make(s, 'nh:scroll_of_identify', 'blessed'));
    expect(s.text(r2)).toContain('You have already identified all of your possessions.');
  });

  test('an empty answer asks again, five times at most', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = levelSetup(undefined, seed);
      plainKit(s.state);
      s.carry('nh:potion_of_healing');
      s.carry('nh:potion_of_water');
      read(s, make(s, 'nh:scroll_of_identify', 'uncursed'));
      if (!s.state.pendingPrompt) continue;
      let tries = 0;
      let last: ReturnType<typeof s.step> | null = null;
      while (s.state.pendingPrompt && tries < 10) {
        last = engine.step(s.state, {
          type: 'answer',
          promptId: s.state.pendingPrompt.prompt.id,
          value: [],
        });
        tries++;
      }
      expect(tries).toBe(5);
      expect(last && s.text(last)).toContain("That's enough tries!");
      return;
    }
    throw new Error('no seed raised a menu');
  });
});

describe('scroll of enchant weapon', () => {
  test('uncursed: +1 and "glows blue for a moment"; the scroll is identified', () => {
    const s = levelSetup();
    plainKit(s.state);
    const r = read(s, make(s, 'nh:scroll_of_enchant_weapon', 'uncursed'));
    expect(item(s, spear(s))?.spe).toBe(2);
    expect(s.text(r)).toContain('Your spear glows blue for a moment.');
    expect(isKnown(s.state, defs, 'nh:scroll_of_enchant_weapon')).toBe(true);
  });

  test('blessed gives 1..3, cursed -1 with black and uncurses nothing', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = levelSetup(undefined, seed);
      read(s, make(s, 'nh:scroll_of_enchant_weapon', 'blessed'));
      seen.add((item(s, spear(s))?.spe ?? 0) - 1);
    }
    expect([...seen].sort()).toEqual([1, 2, 3]);
    const s = levelSetup();
    const r = read(s, make(s, 'nh:scroll_of_enchant_weapon', 'cursed'));
    expect(item(s, spear(s))?.spe).toBe(0);
    expect(s.text(r)).toContain('Your spear glows black for a moment.');
  });

  test('uncurses the weapon when enchanting up', () => {
    const s = levelSetup();
    const it = item(s, spear(s));
    if (it) it.buc = 'cursed';
    read(s, make(s, 'nh:scroll_of_enchant_weapon', 'uncursed'));
    expect(item(s, spear(s))?.buc).toBe('uncursed');
  });

  test('above +5 the weapon usually evaporates', () => {
    let gone = 0;
    let kept = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = levelSetup(undefined, seed);
      const sp = spear(s);
      const it = item(s, sp);
      if (it) it.spe = 6;
      const r = read(s, make(s, 'nh:scroll_of_enchant_weapon', 'uncursed'));
      if (!s.state.entities[String(sp)]) {
        gone++;
        expect(s.text(r)).toContain(
          'Your spear violently glows blue for a while and then evaporates.',
        );
      } else {
        kept++;
        expect(item(s, sp)?.spe).toBe(7);
      }
    }
    expect(gone).toBeGreaterThan(20); // 2 in 3
    expect(kept).toBeGreaterThan(5);
  });

  test('bare hands: a strange feeling for beginners, "Your hands twitch." for veterans', () => {
    const s = levelSetup();
    const sp = item(s, spear(s));
    if (sp) sp.equipped = null;
    const scroll = make(s, 'nh:scroll_of_enchant_weapon', 'uncursed');
    const r = read(s, scroll);
    expect(s.text(r)).toContain('You have a strange feeling for a moment, then it passes.');
    expect(s.state.entities[String(scroll)]).toBeUndefined();
    expect(isKnown(s.state, defs, 'nh:scroll_of_enchant_weapon')).toBe(false);

    const v = levelSetup();
    const sp2 = item(v, spear(v));
    if (sp2) sp2.equipped = null;
    (nhData(v.ctx) as unknown as { urexp: number }).urexp = 2000;
    expect(v.text(read(v, make(v, 'nh:scroll_of_enchant_weapon', 'uncursed')))).toContain(
      'Your hands twitch.',
    );
    const w = levelSetup();
    const sp3 = item(w, spear(w));
    if (sp3) sp3.equipped = null;
    (nhData(w.ctx) as unknown as { urexp: number }).urexp = 2000;
    expect(w.text(read(w, make(w, 'nh:scroll_of_enchant_weapon', 'cursed')))).toContain(
      'Your hands itch.',
    );
  });
});

describe('scroll of enchant armor', () => {
  test('the worn shield: nonmagic armor gets rnd(1 + ...) and glows silver', () => {
    const s = levelSetup();
    plainKit(s.state);
    const r = read(s, make(s, 'nh:scroll_of_enchant_armor', 'uncursed'));
    // +3 small shield: base (4 - 3) / 2 = 0, +1 for nonmagical armor = 1
    expect(item(s, shield(s))?.spe).toBe(4);
    expect(s.text(r)).toContain('Your small shield glows silver for a moment.');
    expect(isKnown(s.state, defs, 'nh:scroll_of_enchant_armor')).toBe(true);
  });

  test('a cursed scroll curses and lowers; a blessed one blesses', () => {
    const s = levelSetup();
    read(s, make(s, 'nh:scroll_of_enchant_armor', 'cursed'));
    expect(item(s, shield(s))?.buc).toBe('cursed');
    // s = -3 -> base (4 + 3) / 2 = 3, +1 nonmagic = 4; rnd(4) down
    expect(item(s, shield(s))?.spe).toBeLessThan(3);
    const b = levelSetup();
    read(b, make(b, 'nh:scroll_of_enchant_armor', 'blessed'));
    expect(item(b, shield(b))?.buc).toBe('blessed');
    expect(item(b, shield(b))?.spe).toBeGreaterThan(3);
  });

  test('above +3 the armor usually evaporates', () => {
    let gone = 0;
    let kept = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = levelSetup(undefined, seed);
      const sh = shield(s);
      const it = item(s, sh);
      if (it) it.spe = 4;
      const r = read(s, make(s, 'nh:scroll_of_enchant_armor', 'uncursed'));
      if (!s.state.entities[String(sh)]) {
        gone++;
        expect(s.text(r)).toContain(
          'Your small shield violently glows silver for a while, then evaporates.',
        );
        expect(findAcNoShield(s)).toBeDefined();
      } else kept++;
    }
    expect(gone).toBeGreaterThan(30); // rn2(4) != 0
    expect(kept).toBeGreaterThan(3);
  });

  test('no armor: a strange feeling (beginner) or "Your skin glows then fades."', () => {
    const s = levelSetup();
    const sh = item(s, shield(s));
    if (sh) sh.equipped = null;
    const scroll = make(s, 'nh:scroll_of_enchant_armor', 'uncursed');
    expect(s.text(read(s, scroll))).toContain(
      'You have a strange feeling for a moment, then it passes.',
    );
    expect(s.state.entities[String(scroll)]).toBeUndefined();
    const v = levelSetup();
    const sh2 = item(v, shield(v));
    if (sh2) sh2.equipped = null;
    (nhData(v.ctx) as unknown as { urexp: number }).urexp = 5000;
    expect(v.text(read(v, make(v, 'nh:scroll_of_enchant_armor', 'uncursed')))).toContain(
      'Your skin glows then fades.',
    );
  });
});

const findAcNoShield = (s: Setup) =>
  inventoryOf(s.state, s.state.playerId).find((e) => e.c.item?.equipped === 'shield') ?? 1;

describe('scroll of remove curse', () => {
  function cursedKit(s: Setup) {
    const spearIt = item(s, spear(s));
    const shieldIt = item(s, shield(s));
    const dagger = item(s, s.byLetter('b'));
    if (spearIt) spearIt.buc = 'cursed';
    if (shieldIt) shieldIt.buc = 'cursed';
    if (dagger) dagger.buc = 'cursed'; // carried, not worn
    return { spearIt, shieldIt, dagger };
  }

  test('uncursed uncurses worn and wielded items only', () => {
    const s = levelSetup();
    const { spearIt, shieldIt, dagger } = cursedKit(s);
    const r = read(s, make(s, 'nh:scroll_of_remove_curse', 'uncursed'));
    expect(spearIt?.buc).toBe('uncursed');
    expect(shieldIt?.buc).toBe('uncursed');
    expect(dagger?.buc).toBe('cursed');
    expect(s.text(r)).toContain('You feel like someone is helping you.');
    // the kit's BUC was known, so the effect was obvious
    expect(isKnown(s.state, defs, 'nh:scroll_of_remove_curse')).toBe(true);
  });

  test('blessed uncurses the whole inventory', () => {
    const s = levelSetup();
    const { dagger } = cursedKit(s);
    const loose = s.carry('nh:potion_of_water');
    const li = item(s, loose);
    if (li) li.buc = 'cursed';
    read(s, make(s, 'nh:scroll_of_remove_curse', 'blessed'));
    expect(dagger?.buc).toBe('uncursed');
    expect(item(s, loose)?.buc).toBe('uncursed');
  });

  test('cursed: the scroll disintegrates and nothing changes', () => {
    const s = levelSetup();
    const { spearIt } = cursedKit(s);
    const r = read(s, make(s, 'nh:scroll_of_remove_curse', 'cursed'));
    expect(spearIt?.buc).toBe('cursed');
    expect(s.text(r)).toEqual([
      'You read the scroll.',
      'You feel like someone is helping you.',
      'The scroll disintegrates.',
    ]);
  });

  test('not learned when no cursed item had a known curse', () => {
    const s = levelSetup();
    const sp = item(s, spear(s));
    if (sp) {
      sp.buc = 'cursed';
      sp.known.buc = false;
    }
    read(s, make(s, 'nh:scroll_of_remove_curse', 'uncursed'));
    expect(sp?.buc).toBe('uncursed');
    expect(isKnown(s.state, defs, 'nh:scroll_of_remove_curse')).toBe(false);
  });

  test('a stack of scrolls: the remaining ones are not touched when uncursed', () => {
    const s = levelSetup();
    const id = make(s, 'nh:scroll_of_remove_curse', 'cursed', { quantity: 2 });
    read(s, id);
    expect(item(s, id)?.quantity).toBe(1);
  });
});

describe('scroll of light', () => {
  const rows = Array.from({ length: 11 }, (_, y) =>
    y === 5 ? '...........@...........' : '.......................',
  );
  const darken = (s: Setup) => {
    const lvl = s.state.levels['dlvl1'];
    if (lvl) lvl.lit = lvl.lit.map(() => 0);
    return lvl;
  };

  test('lights the cells in line of sight within radius 5', () => {
    const s = levelSetup(rows);
    const lvl = darken(s);
    if (!lvl) throw new Error('no level');
    const r = read(s, make(s, 'nh:scroll_of_light', 'uncursed'));
    expect(s.text(r)).toContain('A lit field surrounds you!');
    const at = (x: number, y: number) => lvl.lit[y * lvl.width + x];
    const hx = 11;
    expect(at(hx, 5)).toBe(1);
    expect(at(hx + 5, 5)).toBe(1);
    expect(at(hx + 6, 5)).toBe(0);
    expect(at(hx, 5 + 5)).toBe(1);
    expect(at(hx + 5, 5 + 5)).toBe(0); // outside the circle
    expect(at(hx + 4, 5 + 3)).toBe(1); // dy 3 allows 4
    expect(at(hx + 4, 5 + 4)).toBe(0); // dy 4 allows 3
    expect(isKnown(s.state, defs, 'nh:scroll_of_light')).toBe(true);
  });

  test('blessed reaches radius 9', () => {
    const s = levelSetup(rows);
    const lvl = darken(s);
    if (!lvl) throw new Error('no level');
    read(s, make(s, 'nh:scroll_of_light', 'blessed'));
    expect(lvl.lit[5 * lvl.width + 11 + 9]).toBe(1);
    expect(lvl.lit[5 * lvl.width + 11 + 10]).toBe(0);
  });

  test('cursed darkens a lit area', () => {
    const s = levelSetup(rows);
    const lvl = s.state.levels['dlvl1'];
    if (!lvl) throw new Error('no level');
    const r = read(s, make(s, 'nh:scroll_of_light', 'cursed'));
    expect(s.text(r)).toContain('You are surrounded by darkness!');
    expect(lvl.lit[5 * lvl.width + 11 + 3]).toBe(0);
    expect(lvl.lit[5 * lvl.width + 11 + 8]).toBe(1);
  });

  test('walls block the light: a closed room stays closed', () => {
    const s = levelSetup(['#######', '#..@..#', '#######'].map((r) => r.replace(/#/g, ' ')));
    const lvl = darken(s);
    if (!lvl) throw new Error('no level');
    read(s, make(s, 'nh:scroll_of_light', 'uncursed'));
    expect(lvl.lit[1 * lvl.width + 1]).toBe(1);
    expect(lvl.lit[1 * lvl.width + 5]).toBe(1);
  });
});

describe('read: general', () => {
  test('one move; Read is offered on scrolls only', () => {
    const s = levelSetup();
    const sc = make(s, 'nh:scroll_of_light', 'uncursed');
    const p = s.carry('nh:potion_of_water');
    const offers = (id: number) =>
      engine
        .query(s.state)
        .actionsFor({ kind: 'item', id })
        .flatMap((o) => (o.action.type === 'mod' ? [o.action.action as string] : []));
    expect(offers(sc)).toContain('nh:read');
    expect(offers(p)).not.toContain('nh:read');
    expect(offers(spear(s))).not.toContain('nh:read');
    const turn = s.state.turn;
    read(s, sc);
    expect(s.state.turn).toBe(turn + 1);
  });

  test('the hero is the same entity afterwards', () => {
    const s = levelSetup();
    read(s, make(s, 'nh:scroll_of_light', 'uncursed'));
    expect(getPlayer(s.state).id).toBe(s.state.playerId);
  });
});
