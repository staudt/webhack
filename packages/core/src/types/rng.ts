export interface Rng {
  /** Raw uint32. */
  next(): number;
  /** Uniform integer in [0, x). ref: src/rnd.c rn2() */
  rn2(x: number): number;
  /** Uniform integer in [1, x]. ref: src/rnd.c rnd() */
  rnd(x: number): number;
  /** Sum of n rolls of an s-sided die. ref: src/rnd.c d() */
  d(n: number, s: number): number;
}
