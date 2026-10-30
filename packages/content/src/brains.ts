import type { BrainDef } from '@nh/core';

// Placeholder brain for every vanilla monster. The real dochug/m_move port (ref: src/monmove.c,
// src/monmove.c dochug()) arrives in a later step; until then monsters take no actions.
export const BRAINS: readonly BrainDef[] = [
  {
    id: 'nh:melee',
    act() {
      /* filled in by the monster AI step */
    },
  },
];
