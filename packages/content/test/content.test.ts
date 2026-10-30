import { loadMods } from '@nh/core';
import { describe, expect, test } from 'vitest';
import { ROLES, T, TERRAIN, messagesEn, vanillaMod } from '../src/index';

describe('vanilla content', () => {
  test('loads as a mod', () => {
    expect(() => loadMods([vanillaMod])).not.toThrow();
  });

  test('every terrain and role nameKey has a message', () => {
    const keys = [...TERRAIN, ...ROLES].map((d) => d.nameKey);
    for (const key of keys) {
      expect(messagesEn, key).toHaveProperty([key]);
    }
  });

  test('every T value is a registered terrain', () => {
    const registry = loadMods([vanillaMod]);
    for (const id of Object.values(T)) {
      expect(registry.hasTerrain(id), id).toBe(true);
    }
  });

  test('ids are unique', () => {
    const terrainIds = TERRAIN.map((t) => t.id);
    expect(new Set(terrainIds).size).toBe(terrainIds.length);
    const roleIds = ROLES.map((r) => r.id);
    expect(new Set(roleIds).size).toBe(roleIds.length);
  });

  test('every {param} placeholder is a simple identifier', () => {
    const placeholder = /\{([^{}]*)\}/g;
    for (const [key, text] of Object.entries(messagesEn)) {
      for (const match of text.matchAll(placeholder)) {
        expect(match[1], `${key}: ${text}`).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
      }
    }
  });
});
