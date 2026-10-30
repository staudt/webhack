import { vanillaMod } from '@nh/content';
import { createEngine, createHost, stateHash, type FromCore, type ToCore } from '@nh/core';
import { describe, expect, test } from 'vitest';
import { randomActions } from './helpers/actions';

const SEED = 20240607;
const W = 80;
const H = 21;
const actions = randomActions(400, 99);

function directHash(): string {
  const engine = createEngine([vanillaMod]);
  const { state } = engine.newGame({ seed: SEED, width: W, height: H });
  for (const a of actions) engine.step(state, a);
  return stateHash(state);
}

/** A host behind a simulated worker boundary: every message is structuredClone'd both ways. */
function workerHost(): { send(m: ToCore): FromCore[] } {
  let out: FromCore[] = [];
  const host = createHost([vanillaMod], (m) => out.push(structuredClone(m)));
  return {
    send(m) {
      out = [];
      host.handle(structuredClone(m));
      return out;
    },
  };
}

function hashOf(h: ReturnType<typeof workerHost>): string {
  const r = h.send({ t: 'hash' });
  const m = r[0];
  if (m?.t !== 'hash') throw new Error(`expected hash, got ${JSON.stringify(m)}`);
  return m.hash;
}

describe('determinism', () => {
  test('same seed and actions: engine twice and via the worker message path', () => {
    const a = directHash();
    const b = directHash();
    const host = workerHost();
    host.send({ t: 'new', seed: SEED, width: W, height: H });
    for (const action of actions) {
      const r = host.send({ t: 'act', action });
      expect(r.some((m) => m.t === 'error')).toBe(false);
    }
    expect(a).toBe(b);
    expect(hashOf(host)).toBe(a);
  });

  test('save mid-way, load in a fresh host, continue: same final hash', () => {
    const expected = directHash();
    const host = workerHost();
    host.send({ t: 'new', seed: SEED, width: W, height: H });
    const half = 173;
    for (const action of actions.slice(0, half)) host.send({ t: 'act', action });
    const saved = host.send({ t: 'save' })[0];
    if (saved?.t !== 'saved') throw new Error('no save');
    const midHash = hashOf(host);

    const fresh = workerHost();
    const loaded = fresh.send({ t: 'load', save: saved.save });
    expect(loaded[0]?.t).toBe('view');
    expect(hashOf(fresh)).toBe(midHash);
    for (const action of actions.slice(half)) {
      expect(fresh.send({ t: 'act', action }).some((m) => m.t === 'error')).toBe(false);
    }
    expect(hashOf(fresh)).toBe(expected);
  });
});
