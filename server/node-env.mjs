import { localDB, localBucket } from './storage.mjs';

// This module is used only by the dedicated Node.js build.
export const env = { ...process.env, DB: localDB, BUCKET: localBucket };
