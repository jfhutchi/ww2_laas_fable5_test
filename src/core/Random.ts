/**
 * Deterministic PRNG streams. Everything procedural in the game derives from
 * the URL seed through named forks, so ?seed=N reproduces the entire world
 * and mission regardless of call ordering between systems.
 */

function hashString(str: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function splitmix32(a: number): () => number {
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;
  private readonly seedValue: number;

  constructor(seed: number) {
    this.seedValue = seed >>> 0;
    this.next = splitmix32(this.seedValue);
  }

  /** Uniform [0,1). */
  float(): number {
    return this.next();
  }

  /** Uniform [min,max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer [min,max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Pick uniformly from a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    const item = arr[Math.floor(this.next() * arr.length)];
    if (item === undefined) throw new Error('Rng.pick on empty array');
    return item;
  }

  /** Standard normal via Box-Muller. */
  gaussian(mean = 0, std = 1): number {
    const u = Math.max(this.next(), 1e-9);
    const v = this.next();
    return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Fisher-Yates in place. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const a = arr[i] as T;
      arr[i] = arr[j] as T;
      arr[j] = a;
    }
    return arr;
  }

  /** Independent deterministic sub-stream. */
  fork(name: string): Rng {
    return new Rng((this.seedValue ^ hashString(name)) >>> 0);
  }
}

/** Root RNG for a given world seed. */
export function rootRng(seed: number): Rng {
  return new Rng(hashString(`operation-crossroads:${seed}`));
}

/** Deterministic 2D hash → [0,1), for position-keyed jitter. */
export function hash2D(x: number, y: number, seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (x | 0), 0x27d4eb2f);
  h = Math.imul(h ^ (y | 0), 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
