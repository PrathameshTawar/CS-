// shared/bomb.js — Bomb Defusal rules, shared by the server (which runs
// them) and the client (HUD, hints, sounds).
//
// Attackers spawn at the map's +Z end, defenders at -Z; teams swap roles at
// halftime. One attacker carries the bomb; it drops where the carrier dies
// and any attacker picks it up by walking over it. Standing still inside a
// bomb site with use (F) held plants it; it explodes BOMB_TIME later unless a
// defender holds use beside it for DEFUSE_TIME (KIT_DEFUSE_TIME with a kit).

export const PLANT_TIME = 3.2; // seconds of holding use
export const DEFUSE_TIME = 10;
export const KIT_DEFUSE_TIME = 5;
export const BOMB_TIME = 40; // from plant to explosion
export const BOMB_RADIUS = 14; // m: damage falls to zero here
export const BOMB_DAMAGE = 500; // at the bomb; lethal within ~11 m
export const PICKUP_RADIUS = 1.5; // m (horizontal) to pick up a dropped bomb
export const DEFUSE_RADIUS = 1.6; // m (horizontal) from the bomb to defuse it

export const PLANT_REWARD = 300; // to the planter
export const DEFUSE_REWARD = 300; // to the defuser
export const PLANT_LOSS_BONUS = 800; // to each attacker when they plant but lose
export const BOMB_WIN_REWARD = 3500; // a round won by explosion or defuse

// bomb states (snapshot game[10][0])
export const BOMB_NONE = 0;
export const BOMB_CARRIED = 1;
export const BOMB_DROPPED = 2;
export const BOMB_PLANTED = 3;
export const BOMB_DEFUSED = 4;
export const BOMB_EXPLODED = 5;

// The site (e.g. 'A') whose area contains (x, z), or null.
export function siteAt(sites, x, z) {
  if (!sites) return null;
  for (const [name, s] of Object.entries(sites)) {
    if (x >= s.min[0] && x <= s.max[0] && z >= s.min[1] && z <= s.max[1]) return name;
  }
  return null;
}

// Damage the explosion does at distance d.
export function bombDamage(d) {
  return Math.round(BOMB_DAMAGE * Math.max(0, 1 - d / BOMB_RADIUS));
}
