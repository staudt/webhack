import type { BrainDef } from '@nh/core';
import { dochug, mcalcmove } from './monmove';

// ref: src/monmove.c dochug(), m_move(); src/mon.c mcalcmove()
export const BRAINS: readonly BrainDef[] = [
  {
    id: 'nh:melee',
    act: dochug,
    movement(ctx, self) {
      const a = ctx.state.entities[String(self)]?.c.actor;
      return mcalcmove(ctx.rng, a?.speed ?? 12);
    },
  },
];
