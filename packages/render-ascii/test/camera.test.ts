import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { clampToMap, computeTarget, deadZoneFor, stepCamera, visibleRange } from '../src/camera';

const map = { width: 100, height: 60 };
const view = { cols: 20, rows: 10 };
const dz = { x: 5, y: 2 };

describe('deadZoneFor', () => {
  test('25% with minimum 2, capped', () => {
    expect(deadZoneFor({ cols: 40, rows: 8 })).toEqual({ x: 10, y: 2 });
    expect(deadZoneFor({ cols: 3, rows: 2 })).toEqual({ x: 1, y: 0.5 });
  });
});

describe('computeTarget', () => {
  const cam = { x: 30, y: 20 };
  test('no movement inside the dead zone', () => {
    expect(computeTarget(cam, { x: 40, y: 25 }, map, view, dz)).toEqual(cam);
    expect(computeTarget(cam, { x: 35, y: 22 }, map, view, dz)).toEqual(cam);
  });
  test('minimal movement on each side', () => {
    expect(computeTarget(cam, { x: 34, y: 25 }, map, view, dz).x).toBe(29);
    expect(computeTarget(cam, { x: 45, y: 25 }, map, view, dz).x).toBe(31);
    expect(computeTarget(cam, { x: 40, y: 21 }, map, view, dz).y).toBe(19);
    expect(computeTarget(cam, { x: 40, y: 29 }, map, view, dz).y).toBe(22);
  });
  test('clamps at all four edges', () => {
    expect(computeTarget(cam, { x: 0, y: 25 }, map, view, dz).x).toBe(0);
    expect(computeTarget(cam, { x: 99, y: 25 }, map, view, dz).x).toBe(80);
    expect(computeTarget(cam, { x: 40, y: 0 }, map, view, dz).y).toBe(0);
    expect(computeTarget(cam, { x: 40, y: 59 }, map, view, dz).y).toBe(50);
  });
  test('centers when map is smaller than view', () => {
    const t = computeTarget({ x: 0, y: 0 }, { x: 3, y: 3 }, { width: 10, height: 4 }, view, dz);
    expect(t).toEqual({ x: -5, y: -3 });
  });
});

describe('clampToMap', () => {
  test('clamps and centers', () => {
    expect(clampToMap({ x: -3, y: 99 }, map, view)).toEqual({ x: 0, y: 50 });
    expect(clampToMap({ x: 7, y: 7 }, { width: 20, height: 10 }, view)).toEqual({ x: 0, y: 0 });
  });
});

describe('visibleRange', () => {
  test('includes partially visible edge cells', () => {
    expect(visibleRange({ x: 2.5, y: 1.2 }, view, map)).toEqual({ x0: 2, x1: 23, y0: 1, y1: 12 });
  });
  test('integer camera is exact', () => {
    expect(visibleRange({ x: 2, y: 1 }, view, map)).toEqual({ x0: 2, x1: 22, y0: 1, y1: 11 });
  });
  test('clamps to map', () => {
    expect(visibleRange({ x: -5, y: 55 }, view, map)).toEqual({ x0: 0, x1: 15, y0: 55, y1: 60 });
    expect(visibleRange({ x: 0, y: 0 }, view, { width: 5, height: 3 })).toEqual({
      x0: 0,
      x1: 5,
      y0: 0,
      y1: 3,
    });
  });
});

describe('stepCamera', () => {
  test('converges monotonically and snaps', () => {
    let c = { x: 0, y: 0 };
    const t = { x: 10, y: -4 };
    let prev = Infinity;
    for (let i = 0; i < 200; i++) {
      c = stepCamera(c, t, 1 / 60);
      const d = Math.abs(t.x - c.x);
      expect(d).toBeLessThanOrEqual(prev);
      prev = d;
      if (c.x === t.x && c.y === t.y) break;
    }
    expect(c).toEqual(t);
  });
  test('snaps within 0.01', () => {
    expect(stepCamera({ x: 1.005, y: 0 }, { x: 1, y: 0 }, 0.001)).toEqual({ x: 1, y: 0 });
  });
  test('zero dt does not move beyond snap', () => {
    expect(stepCamera({ x: 0, y: 0 }, { x: 5, y: 5 }, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('properties', () => {
  test('target keeps player in view and camera in map', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 1, max: 40 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (w, h, cols, rows, px, py, cx, cy) => {
          fc.pre(w >= cols && h >= rows);
          const m = { width: w, height: h };
          const v = { cols, rows };
          const p = { x: Math.floor(px * w * 0.9999), y: Math.floor(py * h * 0.9999) };
          const cam = { x: cx * (w - cols), y: cy * (h - rows) };
          const t = computeTarget(cam, p, m, v, deadZoneFor(v));
          expect(t.x).toBeGreaterThanOrEqual(0);
          expect(t.y).toBeGreaterThanOrEqual(0);
          expect(t.x + cols).toBeLessThanOrEqual(w + 1e-9);
          expect(t.y + rows).toBeLessThanOrEqual(h + 1e-9);
          expect(p.x).toBeGreaterThanOrEqual(t.x);
          expect(p.x + 1).toBeLessThanOrEqual(t.x + cols + 1e-9);
          expect(p.y).toBeGreaterThanOrEqual(t.y);
          expect(p.y + 1).toBeLessThanOrEqual(t.y + rows + 1e-9);
        },
      ),
    );
  });
});
