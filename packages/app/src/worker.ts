/// <reference lib="webworker" />
import { createHost } from '@nh/core';
import type { FromCore, ToCore } from '@nh/core';
import { vanillaMod } from '@nh/content';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const host = createHost([vanillaMod], (m: FromCore) => ctx.postMessage(m));
ctx.onmessage = (e: MessageEvent<ToCore>) => host.handle(e.data);
