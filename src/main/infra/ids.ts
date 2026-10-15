import { randomBytes } from 'node:crypto';

export const newId = (bytes = 8) => randomBytes(bytes).toString('hex');
