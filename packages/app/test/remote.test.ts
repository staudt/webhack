import { createHost, type FromCore, type ToCore } from '@nh/core';
import { vanillaMod } from '@nh/content';
import { expect, test } from 'vitest';
import { createRemote, type ViewMessage, type WorkerLike } from '../src/remote';

function simWorker(): WorkerLike {
  const listeners: ((e: { data: FromCore }) => void)[] = [];
  const host = createHost([vanillaMod], (m) => {
    const copy = structuredClone(m);
    queueMicrotask(() => listeners.forEach((l) => l({ data: copy })));
  });
  return {
    postMessage: (m: ToCore) => host.handle(structuredClone(m)),
    addEventListener: (_t, fn) => void listeners.push(fn),
  };
}

test('new, act, queries, errors', async () => {
  const r = createRemote(simWorker());
  const views: ViewMessage[] = [];
  r.onView((m) => views.push(m));
  r.newGame(1, 40, 15);
  await Promise.resolve();
  expect(views).toHaveLength(1);
  expect(views[0]?.view.kind).toBe('full');

  r.act({ type: 'wait' });
  await Promise.resolve();
  expect(views).toHaveLength(2);
  expect(views[1]?.view.kind).toBe('delta');

  const first = views[0]?.view;
  if (first?.kind !== 'full') throw new Error('expected full');
  const { x, y } = first.player;
  const d = await r.query.describe({ x, y });
  expect(d.visible).toBe(true);
  const offers = await r.query.actionsFor({ kind: 'self' });
  expect(offers.length).toBeGreaterThan(0);
  expect(await r.query.pathTo({ x, y })).toEqual(expect.anything());

  await expect(r.query.describe(undefined as never)).rejects.toThrow(/^query \d+:/);
});

test('errors without a query go to onError', async () => {
  const r = createRemote(simWorker());
  const errs: string[] = [];
  r.onError((e) => errs.push(e));
  r.act({ type: 'wait' });
  await Promise.resolve();
  expect(errs).toEqual(['No game in progress']);
});

test('save then load reproduces hash', async () => {
  const a = createRemote(simWorker());
  a.newGame(5, 40, 15);
  a.act({ type: 'wait' });
  a.act({ type: 'search' });
  const save = await a.save();
  const b = createRemote(simWorker());
  b.load(save);
  expect(await b.hash()).toBe(await a.hash());
});
