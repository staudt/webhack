import type { ActionType } from './types/action';
import type { DefId } from './types/common';
import type {
  ActionDef,
  HookName,
  HookOptions,
  Hooks,
  Mod,
  ModApi,
  RegisteredHook,
  Registry,
  RoleDef,
  TerrainDef,
  TimerDef,
  MonsterDef,
  BrainDef,
  AttackType,
  ObjectDef,
  ObjectClass,
  AppearanceDef,
  StatusDef,
  ItemNamer,
} from './types/mod';
import type { ArmorSlot } from './types/entity';

export interface ModLoadIssue {
  modId: string;
  defId?: string;
  /** Field path within the definition or mod, e.g. `glyph.ch`. */
  path: string;
  reason: string;
}

/** Thrown by `loadMods` with every problem found, not just the first. */
export class ModLoadError extends Error {
  readonly issues: readonly ModLoadIssue[];

  constructor(issues: ModLoadIssue[]) {
    const lines = issues.map(
      (i) => `  - [${i.modId}]${i.defId ? ` ${i.defId}` : ''} ${i.path}: ${i.reason}`,
    );
    super(`Failed to load mods:\n${lines.join('\n')}`);
    this.name = 'ModLoadError';
    this.issues = issues;
  }
}

const HOOK_NAMES: readonly HookName[] = [
  'beforeAction',
  'afterAction',
  'endOfTurn',
  'newGame',
  'newLevel',
];
const ACTION_TYPES: readonly ActionType[] = ['move', 'wait', 'search', 'answer', 'mod'];
const ATTACK_TYPES: readonly AttackType[] = [
  'claw',
  'bite',
  'kick',
  'butt',
  'touch',
  'sting',
  'hug',
  'spit',
  'engulf',
  'breath',
  'explode',
  'boom',
  'gaze',
  'tentacle',
  'weapon',
  'magic',
];
const SIZES: readonly MonsterDef['size'][] = [
  'tiny',
  'small',
  'medium',
  'large',
  'huge',
  'gigantic',
];
const OBJECT_CLASSES: readonly ObjectClass[] = [
  'weapon',
  'armor',
  'food',
  'potion',
  'scroll',
  'coin',
  'gem',
];
const ARMOR_SLOTS: readonly ArmorSlot[] = [
  'body',
  'cloak',
  'shirt',
  'helm',
  'gloves',
  'boots',
  'shield',
];

/** Used when no mod sets a namer: the actual name once discovered, else the description. */
const defaultItemNamer: ItemNamer = (state, defs, item) => {
  const def = defs.object(item.def);
  const app = state.appearances[def.id];
  const known = !app && def.descKey === undefined ? true : state.discovered.includes(def.id);
  const key = known ? def.nameKey : app ? defs.appearance(app).nameKey : (def.descKey ?? def.nameKey);
  return { key, params: { count: item.c.item?.quantity ?? 1 } };
};

const MOD_ID = /^[a-z][a-z0-9_-]*$/;
const DEF_NAME = /^[a-z][a-z0-9_-]*$/;

type AnyHook = RegisteredHook & { order: number; seq: number };

/**
 * Runs each mod's `register` in list order and validates everything it defines.
 * Dependencies must appear earlier in the list than the mods that need them.
 */
export function loadMods(mods: readonly Mod[]): Registry {
  const issues: ModLoadIssue[] = [];
  const terrains = new Map<string, TerrainDef>();
  const roles = new Map<string, RoleDef>();
  const timers = new Map<string, TimerDef>();
  const monsters = new Map<string, MonsterDef & { mod: string }>();
  const brains = new Map<string, BrainDef>();
  const objects = new Map<string, ObjectDef & { mod: string }>();
  const appearances = new Map<string, AppearanceDef>();
  const statuses: (StatusDef & { mod: string })[] = [];
  let itemNamer: ItemNamer = defaultItemNamer;
  const actions: (ActionDef & { mod: string })[] = [];
  const builtinHandlers = new Map<ActionType, string>();
  const allIds = new Set<string>();
  const hooks: AnyHook[] = [];
  const loaded: { id: string; version: string }[] = [];
  let seq = 0;

  mods.forEach((mod, order) => {
    const modId = typeof mod.id === 'string' ? mod.id : '?';
    const issue = (path: string, reason: string, defId?: string): void => {
      issues.push(defId === undefined ? { modId, path, reason } : { modId, defId, path, reason });
    };

    if (!MOD_ID.test(modId)) issue('id', `mod id must match ${MOD_ID}`);
    if (loaded.some((m) => m.id === modId)) issue('id', 'duplicate mod id');
    if (typeof mod.version !== 'string' || mod.version === '')
      issue('version', 'must be a non-empty string');
    if (typeof mod.register !== 'function') issue('register', 'must be a function');

    for (const dep of mod.dependsOn ?? []) {
      if (dep === modId) issue('dependsOn', 'mod depends on itself');
      else if (loaded.some((m) => m.id === dep)) continue;
      else if (mods.some((m) => m.id === dep))
        issue('dependsOn', `depends on '${dep}', which must be listed before it`);
      else issue('dependsOn', `depends on unknown mod '${dep}'`);
    }

    const checkId = (id: unknown, kind: string): id is DefId => {
      if (typeof id !== 'string') {
        issue('id', `${kind} id must be a string`);
        return false;
      }
      const [ns, name, ...rest] = id.split(':');
      if (ns !== modId || name === undefined || !DEF_NAME.test(name) || rest.length > 0) {
        issue('id', `${kind} id must be '${modId}:<name>' with name matching ${DEF_NAME}`, id);
        return false;
      }
      if (allIds.has(id)) {
        issue('id', 'duplicate definition id', id);
        return false;
      }
      allIds.add(id);
      return true;
    };
    const str = (v: unknown, path: string, id: string): void => {
      if (typeof v !== 'string' || v === '') issue(path, 'must be a non-empty string', id);
    };
    const bool = (v: unknown, path: string, id: string): void => {
      if (typeof v !== 'boolean') issue(path, 'must be a boolean', id);
    };
    const fn = (v: unknown, path: string, id: string): void => {
      if (typeof v !== 'function') issue(path, 'must be a function', id);
    };

    const glyph = (g: unknown, id: string): void => {
      if (typeof g !== 'object' || g === null) return issue('glyph', 'must be { ch, fg }', id);
      const { ch, fg } = g as { ch?: unknown; fg?: unknown };
      if (typeof ch !== 'string' || [...ch].length !== 1)
        issue('glyph.ch', 'must be exactly one character', id);
      str(fg, 'glyph.fg', id);
    };

    let open = true;
    // A late call can't be reported as an issue (loading may have finished), so it throws.
    const guard = (what: string): true => {
      if (!open)
        throw new Error(
          `[${modId}] ${what} called after register() returned; registration must be synchronous`,
        );
      return true;
    };

    const api: ModApi = {
      defineTerrain(d) {
        if (!guard('defineTerrain') || !checkId(d.id, 'terrain')) return;
        str(d.nameKey, 'nameKey', d.id);
        bool(d.passable, 'passable', d.id);
        bool(d.opaque, 'opaque', d.id);
        if (d.door !== undefined && !['closed', 'locked', 'open', 'doorway'].includes(d.door))
          issue('door', "must be 'closed', 'locked', 'open' or 'doorway'", d.id);
        if (d.stairs !== undefined && !['up', 'down'].includes(d.stairs))
          issue('stairs', "must be 'up' or 'down'", d.id);
        glyph(d.glyph, d.id);
        terrains.set(d.id, d);
      },
      defineRole(d) {
        if (!guard('defineRole') || !checkId(d.id, 'role')) return;
        str(d.nameKey, 'nameKey', d.id);
        if (!Number.isInteger(d.speed) || d.speed <= 0)
          issue('speed', 'must be a positive integer', d.id);
        glyph(d.glyph, d.id);
        if (d.movement !== undefined) fn(d.movement, 'movement', d.id);
        roles.set(d.id, d);
      },
      defineAction(d) {
        if (!guard('defineAction') || !checkId(d.id, 'action')) return;
        str(d.labelKey, 'labelKey', d.id);
        fn(d.offer, 'offer', d.id);
        fn(d.perform, 'perform', d.id);
        if (!ACTION_TYPES.includes(d.handles)) {
          issue('handles', `must be one of ${ACTION_TYPES.join(', ')}`, d.id);
        } else if (d.handles !== 'mod') {
          const prev = builtinHandlers.get(d.handles);
          if (prev !== undefined)
            issue('handles', `'${d.handles}' is already handled by ${prev}`, d.id);
          else builtinHandlers.set(d.handles, d.id);
        }
        actions.push({ ...d, mod: modId });
      },
      defineMonster(d) {
        if (!guard('defineMonster') || !checkId(d.id, 'monster')) return;
        str(d.nameKey, 'nameKey', d.id);
        glyph(d.glyph, d.id);
        const int = (v: unknown, path: string, min: number, max: number): void => {
          if (!Number.isInteger(v) || (v as number) < min || (v as number) > max)
            issue(path, `must be an integer in [${min}, ${max}]`, d.id);
        };
        int(d.level, 'level', -1, 50);
        int(d.speed, 'speed', 0, 50);
        int(d.ac, 'ac', -20, 20);
        int(d.mr, 'mr', 0, 100);
        int(d.alignment, 'alignment', -128, 127);
        int(d.frequency, 'frequency', 0, 7);
        int(d.difficulty, 'difficulty', 0, 100);
        int(d.weight, 'weight', 0, 100000);
        int(d.nutrition, 'nutrition', 0, 10000);
        for (const [k, v] of [
          ['resists', d.resists],
          ['conveys', d.conveys],
        ] as const)
          if (!Array.isArray(v) || v.some((f) => typeof f !== 'string' || f === ''))
            issue(k, 'must be an array of non-empty strings', d.id);
        if (!Array.isArray(d.attacks) || d.attacks.length > 6)
          issue('attacks', 'must be an array of at most 6 attacks', d.id);
        else
          d.attacks.forEach((a, i) => {
            if (!ATTACK_TYPES.includes(a.at))
              issue(`attacks[${i}].at`, `must be one of ${ATTACK_TYPES.join(', ')}`, d.id);
            str(a.ad, `attacks[${i}].ad`, d.id);
            int(a.n, `attacks[${i}].n`, 0, 100);
            int(a.d, `attacks[${i}].d`, 0, 100);
          });
        if (!SIZES.includes(d.size)) issue('size', `must be one of ${SIZES.join(', ')}`, d.id);
        if (d.group !== null && d.group !== 'small' && d.group !== 'large')
          issue('group', "must be 'small', 'large' or null", d.id);
        for (const [k, v] of [
          ['flags', d.flags],
          ['genFlags', d.genFlags],
        ] as const)
          if (!Array.isArray(v) || v.some((f) => typeof f !== 'string' || f === ''))
            issue(k, 'must be an array of non-empty strings', d.id);
        if (typeof d.brain !== 'string') issue('brain', 'must be a brain id', d.id);
        monsters.set(d.id, { ...d, mod: modId });
      },
      defineBrain(d) {
        if (!guard('defineBrain') || !checkId(d.id, 'brain')) return;
        fn(d.act, 'act', d.id);
        if (d.movement !== undefined) fn(d.movement, 'movement', d.id);
        brains.set(d.id, d);
      },
      defineObject(d) {
        if (!guard('defineObject') || !checkId(d.id, 'object')) return;
        str(d.nameKey, 'nameKey', d.id);
        if (d.descKey !== undefined) str(d.descKey, 'descKey', d.id);
        if (!OBJECT_CLASSES.includes(d.class))
          issue('class', `must be one of ${OBJECT_CLASSES.join(', ')}`, d.id);
        glyph(d.glyph, d.id);
        const int = (v: unknown, path: string, min: number, max: number): void => {
          if (!Number.isInteger(v) || (v as number) < min || (v as number) > max)
            issue(path, `must be an integer in [${min}, ${max}]`, d.id);
        };
        int(d.prob, 'prob', 0, 1000);
        int(d.weight, 'weight', 0, 100000);
        int(d.cost, 'cost', 0, 100000);
        int(d.delay, 'delay', 0, 100);
        str(d.material, 'material', d.id);
        bool(d.merge, 'merge', d.id);
        bool(d.magic, 'magic', d.id);
        const dice = (v: unknown, path: string): void => {
          if (!Array.isArray(v) || v.length !== 2) return issue(path, 'must be [n, d]', d.id);
          int(v[0], `${path}[0]`, 0, 100);
          int(v[1], `${path}[1]`, 0, 100);
        };
        if (d.weapon !== undefined) {
          dice(d.weapon.small, 'weapon.small');
          dice(d.weapon.large, 'weapon.large');
          int(d.weapon.hitBonus, 'weapon.hitBonus', -20, 20);
          str(d.weapon.skill, 'weapon.skill', d.id);
          bool(d.weapon.bimanual, 'weapon.bimanual', d.id);
          if (!['pierce', 'slash', 'whack'].includes(d.weapon.kind))
            issue('weapon.kind', "must be 'pierce', 'slash' or 'whack'", d.id);
          if (d.weapon.role !== undefined && !['launcher', 'ammo', 'missile'].includes(d.weapon.role))
            issue('weapon.role', "must be 'launcher', 'ammo' or 'missile'", d.id);
        }
        if (d.armor !== undefined) {
          if (!ARMOR_SLOTS.includes(d.armor.slot))
            issue('armor.slot', `must be one of ${ARMOR_SLOTS.join(', ')}`, d.id);
          int(d.armor.ac, 'armor.ac', -20, 20);
          int(d.armor.mc, 'armor.mc', 0, 3);
        }
        if (d.class === 'armor' && d.armor === undefined)
          issue('armor', 'armor objects need armor stats', d.id);
        if (d.food !== undefined) int(d.food.nutrition, 'food.nutrition', 0, 10000);
        if (d.use !== undefined) fn(d.use, 'use', d.id);
        objects.set(d.id, { ...d, mod: modId });
      },
      defineAppearance(d) {
        if (!guard('defineAppearance') || !checkId(d.id, 'appearance')) return;
        str(d.nameKey, 'nameKey', d.id);
        if (!OBJECT_CLASSES.includes(d.class))
          issue('class', `must be one of ${OBJECT_CLASSES.join(', ')}`, d.id);
        glyph(d.glyph, d.id);
        appearances.set(d.id, d);
      },
      defineStatus(d) {
        if (!guard('defineStatus') || !checkId(d.id, 'status')) return;
        str(d.field, 'field', d.id);
        fn(d.value, 'value', d.id);
        statuses.push({ ...d, mod: modId });
      },
      setItemNamer(namer) {
        if (!guard('setItemNamer')) return;
        if (typeof namer !== 'function') return issue('setItemNamer', 'must be a function');
        itemNamer = namer;
      },
      defineTimer(d) {
        if (!guard('defineTimer') || !checkId(d.id, 'timer')) return;
        fn(d.fire, 'fire', d.id);
        timers.set(d.id, d);
      },
      on<K extends HookName>(name: K, hookFn: Hooks[K], opts?: HookOptions) {
        if (!guard(`on('${String(name)}')`)) return;
        if (!HOOK_NAMES.includes(name)) {
          issue(`on('${String(name)}')`, `unknown hook; expected one of ${HOOK_NAMES.join(', ')}`);
          return;
        }
        const priority = opts?.priority ?? 0;
        if (!Number.isFinite(priority)) issue(`on('${name}').priority`, 'must be a finite number');
        if (typeof hookFn !== 'function') issue(`on('${name}')`, 'handler must be a function');
        hooks.push({ name, mod: modId, priority, fn: hookFn, order, seq: seq++ } as AnyHook & {
          name: HookName;
        });
      },
    };

    if (typeof mod.register === 'function') {
      try {
        mod.register(api);
      } catch (e) {
        issue('register', `threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    open = false;
    loaded.push({ id: modId, version: String(mod.version) });
  });

  // Cross-references are checked once every mod has registered.
  for (const t of terrains.values())
    if (t.looksLike !== undefined && !terrains.has(t.looksLike))
      issues.push({
        modId: t.id.split(':')[0] ?? '?',
        defId: t.id,
        path: 'looksLike',
        reason: `unknown terrain '${t.looksLike}'`,
      });
  for (const m of monsters.values())
    if (typeof m.brain === 'string' && !brains.has(m.brain))
      issues.push({
        modId: m.mod,
        defId: m.id,
        path: 'brain',
        reason: `unknown brain '${m.brain}'`,
      });

  if (issues.length > 0) throw new ModLoadError(issues);

  const sortedHooks = [...hooks].sort(
    (a, b) => b.priority - a.priority || a.order - b.order || a.seq - b.seq,
  ) as (AnyHook & { name: HookName })[];
  const byName = new Map<HookName, RegisteredHook[]>();
  for (const name of HOOK_NAMES) {
    byName.set(
      name,
      sortedHooks
        .filter((h) => h.name === name)
        .map(({ mod, priority, fn }) => ({ mod, priority, fn })),
    );
  }
  const terrainList = [...terrains.values()];
  const roleList = [...roles.values()];

  const registry: Registry = {
    mods: loaded,
    terrain(id) {
      const t = terrains.get(id);
      if (!t) throw new Error(`Unknown terrain '${id}'`);
      return t;
    },
    hasTerrain: (id) => terrains.has(id),
    role(id) {
      const r = roles.get(id);
      if (!r) throw new Error(`Unknown role '${id}'`);
      return r;
    },
    timer(id) {
      const t = timers.get(id);
      if (!t) throw new Error(`Unknown timer '${id}'`);
      return t;
    },
    hasTimer: (id) => timers.has(id),
    monster(id) {
      const m = monsters.get(id);
      if (!m) throw new Error(`Unknown monster '${id}'`);
      return m;
    },
    isMonster: (id) => monsters.has(id),
    object(id) {
      const o = objects.get(id);
      if (!o) throw new Error(`Unknown object '${id}'`);
      return o;
    },
    isObject: (id) => objects.has(id),
    appearance(id) {
      const a = appearances.get(id);
      if (!a) throw new Error(`Unknown appearance '${id}'`);
      return a;
    },
    isAppearance: (id) => appearances.has(id),
    itemName: (state, item) => itemNamer(state, registry, item),
    objects: [...objects.values()],
    appearances: [...appearances.values()],
    statuses,
    brain(id) {
      const b = brains.get(id);
      if (!b) throw new Error(`Unknown brain '${id}'`);
      return b;
    },
    monsters: [...monsters.values()],
    roles: roleList,
    terrains: terrainList,
    actions,
    hooks: <K extends HookName>(name: K) => byName.get(name) as RegisteredHook<K>[],
  };
  return Object.freeze(registry);
}

/** Throws a ModLoadError if any of `ids` is not a registered terrain. */
export function requireTerrains(
  registry: Registry,
  ids: readonly DefId[],
  requiredBy: string,
): void {
  const missing = ids.filter((id) => !registry.hasTerrain(id));
  if (missing.length > 0) {
    throw new ModLoadError(
      missing.map((id) => ({
        modId: requiredBy,
        defId: id,
        path: 'terrain',
        reason: 'required terrain is not registered',
      })),
    );
  }
}
