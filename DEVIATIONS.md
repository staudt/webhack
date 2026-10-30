# Deviations from NetHack

Every intentional rule difference from NetHack is logged here.

| Area             | NetHack behavior                                      | Our behavior                       | Reason                                                                                       |
| ---------------- | ----------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| RNG              | `rn2(x)` uses `RND() % x` (modulo bias)               | Rejection sampling, no modulo bias | Uniform distribution; outcome sequences differ anyway (ref: src/rnd.c)                       |
| Level generation | Secret doors/corridors and locked doors are generated | Not generated in milestone 1       | Search and kick are not implemented yet; avoids unreachable areas (ref: src/mklev.c dosdoor) |
