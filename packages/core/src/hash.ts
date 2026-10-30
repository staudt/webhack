function canon(v: unknown): string | undefined {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false';
    case 'string':
      return JSON.stringify(v);
    case 'number':
      if (!Number.isFinite(v)) throw new TypeError(`canonicalJson: non-finite number ${String(v)}`);
      return JSON.stringify(v);
    case 'undefined':
      return undefined;
    case 'object': {
      if (Array.isArray(v)) {
        return `[${v
          .map((e) => {
            const s = canon(e);
            if (s === undefined) throw new TypeError('canonicalJson: undefined in array');
            return s;
          })
          .join(',')}]`;
      }
      const proto: unknown = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError('canonicalJson: non-plain object');
      }
      const o = v as Record<string, unknown>;
      const parts: string[] = [];
      for (const k of Object.keys(o).sort()) {
        const s = canon(o[k]);
        if (s !== undefined) parts.push(`${JSON.stringify(k)}:${s}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof v}`);
  }
}

/** JSON with recursively sorted object keys. Throws TypeError on non-JSON values. */
export function canonicalJson(v: unknown): string {
  const s = canon(v);
  if (s === undefined) throw new TypeError('canonicalJson: undefined at top level');
  return s;
}

export function isJsonPlain(v: unknown): boolean {
  try {
    canonicalJson(v);
    return true;
  } catch {
    return false;
  }
}

function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** 28-hex-char hash of the canonical JSON of v. */
export function stateHash(v: unknown): string {
  const s = canonicalJson(v);
  return cyrb53(s, 0).toString(16).padStart(14, '0') + cyrb53(s, 0x5bd1e995).toString(16).padStart(14, '0');
}
