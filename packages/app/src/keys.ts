import type { ClientMod } from '@nh/core';

/** Vanilla client keys beyond the UI defaults: stairs. */
export const vanillaKeys: ClientMod = {
  id: 'nh-vanilla-keys',
  version: '1.0.0',
  register(api) {
    api.bindKey('>', { type: 'action', action: { type: 'mod', action: 'nh:down' } });
    api.bindKey('<', { type: 'action', action: { type: 'mod', action: 'nh:up' } });
  },
};
