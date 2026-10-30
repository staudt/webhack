import { describe, expect, test } from 'vitest';
import { createHost } from '../src/host';
import type { FromCore, ToCore } from '../src/types/protocol';
import { applyUpdate } from '../src/view';
import type { ViewSnapshot } from '../src/types/view';
import { fakeMod } from './helpers/fakeMod';
import type { Mod } from '../src/types/mod';
import { stateHash } from '../src/hash';
import { createEngine } from '../src/engine';

/** A three-move action whose progress lives in the occupation data. */
const walkMod: Mod = {
  id: 'wk',
  version: '1.0.0',
  register(api) {
    api.defineAction({
      id: 'wk:three',
      labelKey: 'a.three',
      handles: 'mod',
      offer: () => [],
      perform(ctx) {
        const occ = ctx.state.occupation;
        if (occ) occ.data = ((occ.data as number | null) ?? 0) + 1;
        return 12;
      },
      continues: (ctx) => ((ctx.state.occupation?.data as number | null) ?? 0) < 3,
    });
  },
};

function make() {
  const out: FromCore[] = [];
  const host = createHost([fakeMod], (m) => void out.push(structuredClone(m)));
  const send = (m: ToCore): FromCore => {
    host.handle(structuredClone(m));
    return out[out.length - 1]!;
  };
  return { out, host, send };
}
const NEW: ToCore = { t: 'new', seed: 42, width: 80, height: 21 };

describe('host', () => {
  test('new then act', () => {
    const { send, out } = make();
    const first = send(NEW);
    expect(first.t).toBe('view');
    if (first.t !== 'view') return;
    expect(first.view.kind).toBe('full');
    expect(first.events[0]).toMatchObject({ type: 'msg', key: 'welcome' });
    expect(first.prompt).toBeNull();
    const second = send({ t: 'act', action: { type: 'wait' } });
    expect(second.t === 'view' && second.view.kind).toBe('delta');
    expect(out).toHaveLength(2);
    if (first.t === 'view' && second.t === 'view') {
      const s = applyUpdate(first.view as ViewSnapshot, second.view);
      expect(s.turn).toBeGreaterThan(first.view.turn);
    }
  });

  test('errors before new, unknown message, bad query, engine error', () => {
    const { send } = make();
    for (const m of [
      { t: 'act', action: { type: 'wait' } },
      { t: 'save' },
      { t: 'hash' },
      { t: 'query', id: 1, q: 'describe', args: [{ x: 0, y: 0 }] },
    ] as ToCore[]) {
      expect(send(m).t).toBe('error');
    }
    expect(send({ t: 'bogus' } as unknown as ToCore)).toMatchObject({ t: 'error' });
    send(NEW);
    const bad = send({ t: 'query', id: 9, q: 'constructor' as 'describe', args: [] });
    expect(bad).toMatchObject({ t: 'error' });
    expect(bad.t === 'error' && bad.message).toMatch(/^query 9:/);
    const err = send({ t: 'act', action: { type: 'search' } });
    expect(err.t).toBe('error');
    expect(send({ t: 'act', action: { type: 'wait' } }).t).toBe('view');
    expect(send({ t: 'load', save: 'not json' }).t).toBe('error');
    expect(send({ t: 'query', id: 3, q: 'describe', args: [] }).t).toBe('error');
    expect(send({ t: 'hash' }).t).toBe('hash');
  });

  test('queries round-trip', () => {
    const { send } = make();
    const v = send(NEW);
    if (v.t !== 'view') throw new Error('no view');
    const { x, y } = v.view.kind === 'full' ? v.view.player : { x: 0, y: 0 };
    const d = send({ t: 'query', id: 1, q: 'describe', args: [{ x, y }] });
    expect(d).toMatchObject({ t: 'reply', id: 1 });
    expect(d.t === 'reply' && (d.result as { visible: boolean }).visible).toBe(true);
    const a = send({ t: 'query', id: 2, q: 'actionsFor', args: [{ kind: 'self' }] });
    expect(a.t === 'reply' && (a.result as unknown[]).length).toBe(1);
    const p = send({ t: 'query', id: 3, q: 'pathTo', args: [{ x, y }] });
    expect(p.t === 'reply' && Array.isArray(p.result)).toBe(true);
  });

  test('save/load, welcome back, and replay determinism', () => {
    const a = make();
    a.send(NEW);
    const actions: ToCore[] = (['e', 'e', 's', 'w', 'n', 'se'] as const).flatMap((dir) => [
      { t: 'act', action: { type: 'move', dir } } as ToCore,
      { t: 'act', action: { type: 'wait' } } as ToCore,
    ]);
    for (const m of actions) a.send(m);
    const saved = a.send({ t: 'save' });
    if (saved.t !== 'saved') throw new Error('not saved');
    const h1 = a.send({ t: 'hash' });

    const b = make();
    const loaded = b.send({ t: 'load', save: saved.save });
    expect(loaded.t === 'view' && loaded.view.kind).toBe('full');
    expect(loaded.t === 'view' && loaded.events).toEqual([
      { type: 'msg', key: 'welcome.back', params: { role: '@role.tester' } },
    ]);
    expect(b.send({ t: 'hash' })).toEqual(h1);
    for (const m of actions) {
      a.send(m);
      b.send(m);
    }
    expect(b.send({ t: 'hash' })).toEqual(a.send({ t: 'hash' }));
    // loaded host keeps recording and mirrors correctly
    const next = b.send({ t: 'act', action: { type: 'wait' } });
    expect(next.t === 'view' && next.view.kind).toBe('delta');

    // replay from the saved replay into a fresh host
    const replay = (
      JSON.parse(saved.save) as {
        replay: {
          seed: number;
          width: number;
          height: number;
          actions: ToCore extends never ? never : { type: string }[];
        };
      }
    ).replay;
    expect(replay.actions).toHaveLength(actions.length);
    const c = make();
    c.send({ t: 'new', seed: replay.seed, width: replay.width, height: replay.height });
    for (const action of replay.actions) c.send({ t: 'act', action } as ToCore);
    expect(c.send({ t: 'hash' })).toEqual(h1);
  });
});

describe('host with multi-turn actions', () => {
  const three: ToCore = { t: 'act', action: { type: 'mod', action: 'wk:three' } };
  const cont: ToCore = { t: 'act', action: { type: 'continue' } };
  const mk = () => {
    const out: FromCore[] = [];
    const host = createHost([fakeMod, walkMod], (m) => void out.push(structuredClone(m)));
    const send = (m: ToCore): FromCore => {
      host.handle(structuredClone(m));
      return out[out.length - 1]!;
    };
    return { send };
  };
  const continuing = (m: FromCore): boolean => m.t === 'view' && m.continuing;

  test('view messages carry the continuing flag', () => {
    const { send } = mk();
    expect(continuing(send(NEW))).toBe(false);
    expect(continuing(send(three))).toBe(true);
    expect(continuing(send(cont))).toBe(true);
    expect(continuing(send(cont))).toBe(false);
    expect(continuing(send(cont))).toBe(false); // no occupation: a no-op
  });

  test('a loaded game with an occupation reports continuing on the full view', () => {
    const a = mk();
    a.send(NEW);
    a.send(three);
    const saved = a.send({ t: 'save' });
    if (saved.t !== 'saved') throw new Error('not saved');
    const b = mk();
    expect(continuing(b.send({ t: 'load', save: saved.save }))).toBe(true);
  });

  test('the replay records continue actions and replays to the same hash', () => {
    const a = mk();
    a.send(NEW);
    for (const m of [
      three,
      cont,
      { t: 'act', action: { type: 'wait' } } as ToCore,
      three,
      cont,
      cont,
    ])
      a.send(m);
    const h = a.send({ t: 'hash' });
    const saved = a.send({ t: 'save' });
    if (saved.t !== 'saved') throw new Error('not saved');
    const file = JSON.parse(saved.save) as {
      replay: { seed: number; width: number; height: number; actions: { type: string }[] };
    };
    expect(file.replay.actions.map((x) => x.type)).toEqual([
      'mod',
      'continue',
      'wait',
      'mod',
      'continue',
      'continue',
    ]);
    const engine = createEngine([fakeMod, walkMod]);
    const state = engine.newGame({
      seed: file.replay.seed,
      width: file.replay.width,
      height: file.replay.height,
    }).state;
    for (const action of file.replay.actions) engine.step(state, action as never);
    expect(h).toEqual({ t: 'hash', hash: stateHash(state) });
  });
});
