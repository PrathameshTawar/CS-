// shared/names.js — what a player may be called in public rooms.
//
// The server runs every name through playerName(): the protocol's character
// filter, then no impersonating the bots, and no slurs or obscenities
// (English and Hindi, caught through spacing, punctuation, repeats and
// look-alike digits). A refused name becomes "player". Short or ambiguous
// words are left out on purpose: blocking "ass" would also block "Cassie".

import { cleanLabel } from './protocol.js';

export const FALLBACK_NAME = 'player';

// Matched anywhere in the squashed name (lowercase letters only).
const BLOCKED = [
  // English
  'fuck', 'fvck', 'fuk', 'fck', 'nigga', 'niga', 'nigger', 'faggot', 'retard', 'whore', 'slut',
  'bitch', 'bastard', 'dickhead', 'pussy', 'penis', 'vagina', 'rapist', 'nazi', 'hitler',
  'kike', 'chink', 'tranny', 'wank', 'twat', 'jizz', 'porn', 'molest',
  // Hindi (romanised)
  'chutiya', 'chutia', 'madarchod', 'maderchod', 'bhenchod', 'behenchod', 'bhanchod', 'gandu',
  'bhosdi', 'bhosad', 'jhaat', 'harami', 'kamina',
];
// words that are also parts of ordinary names (Grape, Torpedo, Hancock,
// Kshitij, Scunthorpe, Lundgren, Lauda): refused only as a whole word of the
// name (digits around it don't count), or the whole name squashed together
const WHOLE = ['shit', 'cunt', 'mc', 'bc', 'cum', 'spic', 'rape', 'cock', 'pedo', 'fag', 'lund', 'lauda', 'loda', 'chod', 'kutta'];

const LOOKALIKE = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g' };

// The name with tricks removed: lowercase, look-alike digits as letters,
// everything but letters dropped, repeated letters collapsed.
export function squash(name) {
  return String(name)
    .toLowerCase()
    .replace(/[0-9]/g, (d) => LOOKALIKE[d] || '')
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1+/g, '$1');
}

export function isOffensive(name) {
  const s = squash(name);
  if (!s) return false;
  const like = (w) => w.replace(/(.)\1+/g, '$1'); // compare like with like
  if (BLOCKED.some((w) => s.includes(like(w)))) return true;
  const words = String(name)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => squash(t.replace(/^[0-9]+|[0-9]+$/g, '')));
  return WHOLE.some((w) => s === like(w) || words.includes(like(w)));
}

// The name a player gets, from what they typed.
export function playerName(raw) {
  let name = cleanLabel(raw, FALLBACK_NAME, 16);
  // "BOT ..." is how the room marks computer players
  name = name.replace(/^bot(\s+|$)/i, '').trim() || FALLBACK_NAME;
  return isOffensive(name) ? FALLBACK_NAME : name;
}
