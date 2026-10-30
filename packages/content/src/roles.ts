// Stub until roles are ported. ref: src/role.c
import type { RoleDef } from '@nh/core';
import { heroMovement } from './stats';

export const ROLES: readonly RoleDef[] = [
  {
    id: 'nh:valkyrie',
    nameKey: 'role.valkyrie',
    speed: 12,
    glyph: { ch: '@', fg: '#ffffff' },
    movement: heroMovement,
  },
];
