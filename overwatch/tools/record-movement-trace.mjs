// tools/record-movement-trace.mjs — re-records tests/fixtures/movement-trace.json
// from the shared movement step. Only for a deliberate change to how players
// move: the movement tests exist to catch accidental ones.
//
// Usage: node tools/record-movement-trace.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { runSharedTrace } from '../tests/movement-script.js';

const fixtures = new URL('../tests/fixtures/', import.meta.url);
const colliders = JSON.parse(readFileSync(new URL('plaza-colliders.json', fixtures), 'utf8'));
const rows = runSharedTrace(colliders);
writeFileSync(new URL('movement-trace.json', fixtures), JSON.stringify(rows));
console.log(`movement-trace.json: ${rows.length} rows`);
