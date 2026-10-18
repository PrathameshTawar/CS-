// server/room.js — one authoritative match: players, inputs, simulation,
// combat, snapshots. No sockets here (index.js owns those), so it is
// unit-testable.
//
// Simulation model:
// - Every player is stepped with shared/movement.js at TICK_RATE, the same
//   step and rate the client predicts with, so a client that sent the same
//   inputs lands on the same position.
// - A player only moves when their inputs arrive (one input = one step). A
//   backgrounded tab stops sending and simply stands still.
// - Each tick grants every player one step of credit (capped). Inputs beyond
//   the credit wait in a bounded queue, so a client can never move faster
//   than real time (no speed hacks), only catch up after jitter.
//
// Combat model:
// - Shots and reloads are tagged with the input seq they happen before and
//   resolved right before that input is applied: the server checks them
//   against exactly the state the client fired from.
// - Fire rate, ammo and reloads are timed in the shooter's own input steps
//   (1/120 s each), the same clock the client's weapon runs on.
// - Lag compensation: every tick records each player's hitbox; a shot rewinds
//   the other players to the tick the shooter was looking at (at most
//   MAX_REWIND_TICKS back) and traces shared/combat.js against them.
//
// Match model (mode 'teams'; 'dm' is free-for-all with respawns):
// - Players are auto-balanced into ALPHA/BRAVO; no friendly fire (rounds
//   pass through teammates).
// - WARMUP (respawns on) until both teams have a player, then rounds:
//   FREEZE (everyone at their team spawns, can't move or shoot) -> LIVE (no
//   respawns; eliminate the other team, or have more players alive when the
//   clock runs out) -> END (banner) -> next round. First to roundsToWin takes
//   the match; MATCH_END shows the result, then a new match starts.
// - Late joiners sit out (dead) until the next round starts.
//
// Bomb Defusal (mode 'bomb', maps with bomb sites; shared/bomb.js has the
// numbers): the same rounds, but the attacking team (game.attackers) spawns
// at the map's +Z end and must plant the bomb on a site; the defenders win
// by defusing it, by killing every attacker before a plant, or when time
// runs out with no plant. After a plant, only the bomb (or wiping out the
// defenders) ends the round. Teams swap sides at halftime.
//
// Weapons and money (shared/weapons.js has the table and the rules):
// - Each player carries a primary (or none) and a secondary, each with its
//   own ammo, and holds one of them. Switches ride the input stream like
//   reloads; a switch cancels a reload, and the new weapon can't fire until
//   it is drawn.
// - buy()/sell() come from their own messages. Team rounds charge money and
//   need buy time and the buy zone; warmup and deathmatch buy for free,
//   anywhere. Kills and round results pay out at the end of each event.

import { CollisionWorld } from '../shared/collision.js';
import { createRng } from '../shared/rng.js';
import {
  BOMB_CARRIED,
  BOMB_DEFUSED,
  BOMB_DROPPED,
  BOMB_EXPLODED,
  BOMB_PLANTED,
  BOMB_TIME,
  BOMB_WIN_REWARD,
  DEFUSE_RADIUS,
  DEFUSE_REWARD,
  DEFUSE_TIME,
  KIT_DEFUSE_TIME,
  PICKUP_RADIUS,
  PLANT_LOSS_BONUS,
  PLANT_REWARD,
  PLANT_TIME,
  bombDamage,
  siteAt,
} from '../shared/bomb.js';
import { KILL_Y, createMoveState, stepMove } from '../shared/movement.js';
import {
  MAX_HEALTH,
  RESPAWN_TIME,
  isHeadshot,
  playerHitbox,
  shotEndpoint,
  traceShot,
} from '../shared/combat.js';
import {
  BUY_RADIUS,
  BUY_TIME,
  EQUIPMENT,
  MAX_ARMOR,
  applyArmor,
  DEFAULT_PRIMARY,
  DEFAULT_SECONDARY,
  MAX_MONEY,
  PRIMARY,
  SECONDARY,
  START_MONEY,
  WEAPONS,
  WIN_REWARD,
  LOSS_REWARD,
  defaultSlot,
  lossReward,
  makeGun,
  weaponIndex,
} from '../shared/weapons.js';
import {
  BUY_FREE,
  BUY_OPEN,
  BUY_SELL_PRIMARY,
  BUY_SELL_SECONDARY,
  BOMBEV_DEFUSED,
  BOMBEV_DROPPED,
  BOMBEV_EXPLODED,
  BOMBEV_PICKED,
  BOMBEV_PLANTED,
  END_BOMB,
  END_DEFUSED,
  END_ELIMINATION,
  END_FORFEIT,
  END_TIME,
  EV_BOMB,
  EV_HALFTIME,
  EV_HIT,
  EV_KILL,
  EV_MATCH_END,
  EV_ROUND_END,
  EV_SHOT,
  EV_SPAWN,
  MAX_INPUTS_PER_MESSAGE,
  MAX_PLAYERS_PER_ROOM,
  MAX_REWIND_TICKS,
  MAX_SHOTS_PER_MESSAGE,
  KILL_BY_BOMB,
  MODE_BOMB,
  MODE_DM,
  MODE_TEAMS,
  PHASE_END,
  PHASE_FREEZE,
  PHASE_LIVE,
  PHASE_MATCH_END,
  PHASE_WARMUP,
  PL_CROUCH,
  PL_DEAD,
  PL_GROUNDED,
  TICK_RATE,
  USE_DEFUSE,
  USE_NONE,
  USE_PLANT,
  packState,
  readInput,
  readShot,
  readSwitch,
} from '../shared/protocol.js';

const H = 1 / TICK_RATE;
const MAX_CREDIT = TICK_RATE / 4; // 250 ms of catch-up after a stall
const MAX_QUEUE = TICK_RATE / 2; // inputs waiting beyond credit; older ones are dropped
const MAX_PENDING_ACTIONS = 16; // shots/reloads waiting for their input seq
const HISTORY = 64; // ticks of hitbox history kept per player (> MAX_REWIND_TICKS)

// combat timing in input steps, per weapon. The client times its weapon on
// the same fixed steps; allow a step of slack between shots, and end reloads
// and draws 50 ms early, so a legit shot right at the boundary isn't refused.
const TIMING = {};
for (const w of Object.values(WEAPONS)) {
  TIMING[w.id] = {
    fire: Math.round(w.interval * TICK_RATE) - 1,
    reload: Math.round(w.reloadTime * TICK_RATE) - 6,
    refill: Math.round(w.refillAt * TICK_RATE),
    draw: Math.max(0, Math.round(w.drawTime * TICK_RATE) - 6),
  };
}
const RESPAWN_TICKS = RESPAWN_TIME * TICK_RATE;
// how far the reported muzzle may be from the server's eye position: the
// weapon offset (~0.26 m) plus lean, bob and recoil, with margin
const MAX_MUZZLE_OFFSET = 0.75;

// Spawn points on open ground around the plaza; tests check each one lands on
// the street level. Players spawn high and the mover drops them onto the
// surface below, exactly like single player.
export const SPAWNS = [
  [6, 16], [-6, 16], [16, 6], [16, -6],
  [6, -16], [-6, -16], [-16, 6], [-16, -6],
];
// each team spawns on its own side of the plaza (+Z / -Z)
export const TEAM_SPAWNS = [SPAWNS.filter((s) => s[1] > 0), SPAWNS.filter((s) => s[1] < 0)];

// round timings, in ticks (overridable per room, e.g. for tests)
export const DEFAULT_RULES = Object.freeze({
  freezeTicks: 6 * TICK_RATE, // time to buy before the round goes live
  roundTicks: 115 * TICK_RATE,
  endTicks: 5 * TICK_RATE,
  matchEndTicks: 10 * TICK_RATE,
  roundsToWin: 8,
  buyTicks: BUY_TIME * TICK_RATE, // after the freeze ends
  // Bomb Defusal
  plantTicks: Math.round(PLANT_TIME * TICK_RATE),
  defuseTicks: DEFUSE_TIME * TICK_RATE,
  kitDefuseTicks: KIT_DEFUSE_TIME * TICK_RATE,
  bombTicks: BOMB_TIME * TICK_RATE,
  halftime: true, // swap sides after roundsToWin - 1 rounds
});
const SPAWN_HEIGHT = 60;
const IDLE = Object.freeze({ forward: 0, right: 0, jump: false, crouch: false, sprint: false, ads: 0 });

export class Room {
  constructor(name, colliders, { seed, map = 'plaza', mapData = null, maxPlayers = MAX_PLAYERS_PER_ROOM, mode = MODE_TEAMS, rules = {} } = {}) {
    this.name = name;
    this.seed = seed;
    this.map = map;
    this.mapData = mapData;
    this.teamSpawns = mapData && mapData.spawns ? mapData.spawns : TEAM_SPAWNS;
    this.spawns = mapData && mapData.spawns ? [...mapData.spawns[0], ...mapData.spawns[1]] : SPAWNS;
    this.maxPlayers = maxPlayers;
    this.sites = (mapData && mapData.sites) || null;
    // Bomb Defusal needs bomb sites; without them it's team elimination
    this.mode = mode === MODE_DM ? MODE_DM : mode === MODE_BOMB && this.sites ? MODE_BOMB : MODE_TEAMS;
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.game = {
      phase: PHASE_WARMUP,
      endsAt: 0,
      round: 0,
      score: [0, 0],
      lastWinner: -1,
      buyUntil: 0,
      lossStreak: [0, 0],
      attackers: 0, // the team that spawns at +Z (and carries the bomb)
      bomb: null, // Bomb Defusal: { state, carrier, x, y, z, site, explodeAt, defuser, planted }
      halfDone: false,
    };
    this._rng = createRng(((seed || 1) ^ 0xb0b5) >>> 0); // who carries the bomb
    this.world = new CollisionWorld(colliders);
    this.players = new Map();
    this.tick = 0;
    this.events = []; // { n, tick, data }
    this._eventN = 0;
    this._nextId = 1;
    this._out = { hasWish: false, landed: false, impact: 0 };
    this._end = { x: 0, y: 0, z: 0 };
    this._boxes = []; // rewound hitboxes for the shot being resolved (reused)
  }

  get size() {
    return this.players.size;
  }

  // Adds a player; returns it, or null when the room is full.
  join(name) {
    if (this.players.size >= this.maxPlayers) return null;
    const history = [];
    for (let i = 0; i < HISTORY; i++) history.push({ tick: -1, x: 0, y: 0, z: 0, halfY: 0, alive: false });
    const player = {
      id: this._nextId++,
      name,
      move: null,
      pitch: 0,
      queue: [],
      credit: 0,
      lastSeq: -1,
      dropped: 0,
      steps: 0, // inputs applied: the player's own combat clock
      actions: [], // pending { seq, shot | reload }
      hp: MAX_HEALTH,
      dead: false,
      respawnTick: 0,
      spawns: 0,
      loadout: this._startingLoadout(),
      slot: PRIMARY,
      money: START_MONEY,
      reloadStart: -1,
      lastFire: -Infinity,
      drawEnd: 0, // the held weapon can fire from this step on
      kills: 0,
      deaths: 0,
      team: this.mode !== MODE_DM ? this._smallerTeam() : -1,
      armor: 0,
      helmet: false,
      kit: false,
      useKind: USE_NONE, // planting or defusing
      useSteps: 0,
      rejected: 0, // shots refused (rate, ammo, origin): a cheat signal
      eventsSeen: this._eventN,
      history,
      hitbox: { min: [0, 0, 0], max: [0, 0, 0], surface: 'flesh', owner: null },
      // the held weapon and its ammo
      get gun() {
        return this.loadout[this.slot];
      },
      get ammo() {
        return this.loadout[this.slot].ammo;
      },
      get reserve() {
        return this.loadout[this.slot].reserve;
      },
    };
    player.hitbox.owner = player;
    player.slot = defaultSlot(player.loadout);
    const [x, z] = this._spawnPoint(player);
    this._place(player, x, z);
    // mid-round joiners sit out until the next round
    const phase = this.game.phase;
    if (this.mode !== MODE_DM && (phase === PHASE_LIVE || phase === PHASE_END || phase === PHASE_MATCH_END)) {
      player.dead = true;
      player.hp = 0;
      player.respawnTick = Infinity;
    }
    this.players.set(player.id, player);
    this._record(player);
    return player;
  }

  // Warmup and deathmatch hand out a rifle and buy for free; a team match
  // starts everyone on the free pistol.
  get freeBuy() {
    return this.mode === MODE_DM || this.game.phase === PHASE_WARMUP;
  }

  _startingLoadout() {
    return [this.freeBuy ? makeGun(DEFAULT_PRIMARY) : null, makeGun(DEFAULT_SECONDARY)];
  }

  _smallerTeam() {
    const n = [0, 0];
    for (const p of this.players.values()) if (p.team >= 0) n[p.team]++;
    return n[1] < n[0] ? 1 : 0;
  }

  // Free movement and shooting? Not while frozen at round start or after a match.
  get frozen() {
    return this.game.phase === PHASE_FREEZE || this.game.phase === PHASE_MATCH_END;
  }

  // Respawn on death? In deathmatch and warmup; not during a team round.
  get respawning() {
    return this.mode === MODE_DM || this.game.phase === PHASE_WARMUP;
  }

  leave(id) {
    const p = this.players.get(id);
    if (p) this._dropIfCarrier(p);
    return this.players.delete(id);
  }

  // Queues a batch of wire inputs plus optional shots/reloads. Returns false
  // if anything is malformed (the caller should drop the client). Old or
  // duplicate seqs are ignored.
  receiveInputs(id, batch, shots = undefined, reloads = undefined, switches = undefined) {
    const p = this.players.get(id);
    if (!p) return false;
    if (!Array.isArray(batch) || batch.length > MAX_INPUTS_PER_MESSAGE) return false;
    const queuedSeq = p.queue.length ? p.queue[p.queue.length - 1].seq : p.lastSeq;
    let last = queuedSeq;
    for (const raw of batch) {
      const input = readInput(raw);
      if (!input) return false;
      if (input.seq <= last) continue; // resend or out of order
      p.queue.push(input);
      last = input.seq;
    }
    if (p.queue.length > MAX_QUEUE) {
      p.dropped += p.queue.length - MAX_QUEUE;
      p.queue.splice(0, p.queue.length - MAX_QUEUE);
    }
    if (shots !== undefined) {
      if (!Array.isArray(shots) || shots.length > MAX_SHOTS_PER_MESSAGE) return false;
      for (const raw of shots) {
        const shot = readShot(raw);
        if (!shot) return false;
        p.actions.push({ seq: shot.seq, shot });
      }
    }
    if (reloads !== undefined) {
      if (!Array.isArray(reloads) || reloads.length > MAX_SHOTS_PER_MESSAGE) return false;
      for (const seq of reloads) {
        if (!Number.isInteger(seq) || seq < 0) return false;
        p.actions.push({ seq, reload: true });
      }
    }
    if (switches !== undefined) {
      if (!Array.isArray(switches) || switches.length > MAX_SHOTS_PER_MESSAGE) return false;
      for (const raw of switches) {
        const sw = readSwitch(raw);
        if (!sw) return false;
        p.actions.push({ seq: sw.seq, slot: sw.slot });
      }
    }
    if (p.actions.length > MAX_PENDING_ACTIONS) p.actions.splice(0, p.actions.length - MAX_PENDING_ACTIONS);
    return true;
  }

  // One authoritative tick.
  step() {
    this.tick++;
    for (const p of this.players.values()) {
      p.credit = Math.min(MAX_CREDIT, p.credit + 1);
      while (p.credit >= 1 && p.queue.length) {
        const input = p.queue.shift();
        p.credit -= 1;
        this._runActions(p, input.seq);
        p.lastSeq = input.seq;
        p.pitch = input.pitch;
        // inputs are consumed (acked) but the dead and the frozen don't move
        if (p.dead || this.frozen) continue;
        p.move.yaw = input.yaw;
        stepMove(p.move, input, H, this.world, this._out);
        p.steps++;
        if (p.move.pos.y < KILL_Y) {
          this._kill(p, null, false); // fell off the map
          continue;
        }
        if (this.mode === MODE_BOMB) this._bombUse(p, input);
        if (p.reloadStart >= 0) {
          const gun = p.gun;
          const timing = TIMING[gun.id];
          const t = p.steps - p.reloadStart;
          if (t === timing.refill) {
            const take = Math.min(WEAPONS[gun.id].mag - gun.ammo, gun.reserve);
            gun.ammo += take;
            gun.reserve -= take;
          }
          if (t >= timing.reload) p.reloadStart = -1;
        }
      }
      if (p.dead && this.respawning && this.tick >= p.respawnTick) this._respawn(p);
    }
    if (this.mode === MODE_BOMB) this._updateBomb();
    if (this.mode !== MODE_DM) this._updateMatch();
    for (const p of this.players.values()) this._record(p);
    this._trimEvents();
  }

  // ---- rounds ----

  _updateMatch() {
    const g = this.game;
    const r = this.rules;
    const count = [0, 0];
    const alive = [0, 0];
    for (const p of this.players.values()) {
      count[p.team]++;
      if (!p.dead) alive[p.team]++;
    }
    const bothTeams = count[0] > 0 && count[1] > 0;
    switch (g.phase) {
      case PHASE_WARMUP:
        if (bothTeams) this._newMatch();
        break;
      case PHASE_FREEZE:
      case PHASE_LIVE:
        if (!bothTeams) {
          this._endRound(count[0] > 0 ? 0 : count[1] > 0 ? 1 : -1, END_FORFEIT);
        } else if (g.phase === PHASE_FREEZE) {
          if (this.tick >= g.endsAt) {
            g.phase = PHASE_LIVE;
            g.endsAt = this.tick + r.roundTicks;
          }
        } else if (this.mode === MODE_BOMB) {
          const att = g.attackers;
          const def = 1 - att;
          const planted = g.bomb && g.bomb.state === BOMB_PLANTED;
          if (alive[def] === 0) this._endRound(att, END_ELIMINATION);
          else if (alive[att] === 0 && !planted) this._endRound(def, END_ELIMINATION);
          else if (!planted && this.tick >= g.endsAt) this._endRound(def, END_TIME);
          // once planted, the bomb ends the round (_updateBomb)
        } else if (alive[0] === 0 || alive[1] === 0) {
          this._endRound(alive[0] > 0 ? 0 : alive[1] > 0 ? 1 : -1, END_ELIMINATION);
        } else if (this.tick >= g.endsAt) {
          this._endRound(alive[0] > alive[1] ? 0 : alive[1] > alive[0] ? 1 : -1, END_TIME);
        }
        break;
      case PHASE_END:
        if (this.tick < g.endsAt) break;
        if (!bothTeams) this._warmup();
        else if (Math.max(g.score[0], g.score[1]) >= r.roundsToWin) {
          g.phase = PHASE_MATCH_END;
          g.endsAt = this.tick + r.matchEndTicks;
          this._emit([EV_MATCH_END, g.score[0] > g.score[1] ? 0 : 1]);
        } else {
          const half = Math.max(1, r.roundsToWin - 1);
          if (this.mode === MODE_BOMB && r.halftime && !g.halfDone && g.round >= half) this._halftime();
          this._startRound(g.round + 1);
        }
        break;
      case PHASE_MATCH_END:
        if (this.tick < g.endsAt) break;
        if (bothTeams) this._newMatch();
        else this._warmup();
        break;
    }
  }

  _newMatch() {
    this.game.score = [0, 0];
    this.game.lastWinner = -1;
    this.game.lossStreak = [0, 0];
    this.game.attackers = 0;
    this.game.halfDone = false;
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      this._resetEconomy(p);
    }
    this._startRound(1);
  }

  // A fresh start for p's money and gear (match start, halftime).
  _resetEconomy(p) {
    p.money = START_MONEY;
    p.armor = 0;
    p.helmet = false;
    p.kit = false;
    p.dead = true; // the next round starts p on the free pistol
  }

  // Halftime in Bomb Defusal: the teams swap sides; money and gear reset.
  _halftime() {
    const g = this.game;
    g.halfDone = true;
    g.attackers = 1 - g.attackers;
    g.lossStreak = [0, 0];
    for (const p of this.players.values()) this._resetEconomy(p);
    this._emit([EV_HALFTIME, g.attackers]);
  }

  // Everyone to their team spawns, full health and ammo, frozen briefly.
  // Survivors keep their weapons; the dead start over on the free pistol.
  _startRound(n) {
    const g = this.game;
    g.round = n;
    g.phase = PHASE_FREEZE;
    g.endsAt = this.tick + this.rules.freezeTicks;
    g.buyUntil = g.endsAt + this.rules.buyTicks;
    const used = [0, 0];
    for (const p of this.players.values()) {
      if (p.dead) p.loadout = [null, makeGun(DEFAULT_SECONDARY)];
      const spawns = this._sideSpawns(p.team);
      const [x, z] = spawns[used[p.team]++ % spawns.length];
      this._revive(p, x, z);
    }
    if (this.mode === MODE_BOMB) this._giveBomb();
  }

  // Attackers spawn on the +Z side (teamSpawns[0]), defenders on -Z. Outside
  // Bomb Defusal the attackers are always team 0, so each team keeps its side.
  _sideSpawns(team) {
    return this.teamSpawns[team === this.game.attackers ? 0 : 1];
  }

  _endRound(winner, reason) {
    const g = this.game;
    const pay = [LOSS_REWARD, LOSS_REWARD]; // a draw
    if (winner >= 0) {
      g.score[winner]++;
      const loser = 1 - winner;
      g.lossStreak[winner] = 0;
      g.lossStreak[loser]++;
      pay[winner] = reason === END_BOMB || reason === END_DEFUSED ? BOMB_WIN_REWARD : WIN_REWARD;
      pay[loser] = lossReward(g.lossStreak[loser]);
    }
    // attackers who planted but still lost get a bonus
    if (g.bomb && g.bomb.planted && winner !== g.attackers) pay[g.attackers] += PLANT_LOSS_BONUS;
    for (const p of this.players.values()) {
      this._pay(p, pay[p.team]);
      p.useKind = USE_NONE;
      p.useSteps = 0;
    }
    g.lastWinner = winner;
    g.phase = PHASE_END;
    g.endsAt = this.tick + this.rules.endTicks;
    this._emit([EV_ROUND_END, g.round, winner, reason]);
  }

  // Back to warmup (a team emptied out): free play, everyone respawns.
  _warmup() {
    const g = this.game;
    g.phase = PHASE_WARMUP;
    g.round = 0;
    g.score = [0, 0];
    g.lastWinner = -1;
    g.bomb = null;
    g.attackers = 0;
    for (const p of this.players.values()) if (p.dead) p.respawnTick = this.tick;
  }

  _pay(p, amount) {
    p.money = Math.min(MAX_MONEY, p.money + amount);
  }

  // ---- buying ----

  // Can p buy (or sell) right now? Free modes: whenever alive. Team rounds:
  // during the freeze and buy time, near one of the team's spawn points.
  canBuy(p) {
    if (p.dead) return false;
    if (this.freeBuy) return true;
    const g = this.game;
    if (!(g.phase === PHASE_FREEZE || g.phase === PHASE_LIVE) || this.tick >= g.buyUntil) return false;
    const pos = p.move.pos;
    return this._sideSpawns(p.team).some(([x, z]) => Math.hypot(pos.x - x, pos.z - z) <= BUY_RADIUS);
  }

  // Buys weapon `weaponId` into its slot. Returns true, or why not. A weapon
  // bought earlier this round in the same slot is refunded as it's replaced.
  buy(id, weaponId) {
    const p = this.players.get(id);
    if (!p) return 'no-player';
    if (typeof weaponId === 'string' && Object.hasOwn(EQUIPMENT, weaponId)) return this._buyGear(p, EQUIPMENT[weaponId]);
    if (typeof weaponId !== 'string' || !Object.hasOwn(WEAPONS, weaponId)) return 'bad-weapon';
    const w = WEAPONS[weaponId];
    if (w.price <= 0) return 'not-for-sale';
    if (!this.canBuy(p)) return 'cannot-buy';
    const cur = p.loadout[w.slot];
    if (cur && cur.id === weaponId) return 'owned';
    const cost = this.freeBuy ? 0 : w.price;
    const refund = cur && cur.bought ? cur.paid : 0;
    if (p.money + refund < cost) return 'no-money';
    p.money = Math.min(MAX_MONEY, p.money + refund) - cost;
    const gun = makeGun(weaponId);
    gun.bought = true;
    gun.paid = cost;
    gun.prev = cur && cur.bought ? cur.prev : cur; // what selling it gives back
    p.loadout[w.slot] = gun;
    if (p.slot === w.slot) this._draw(p);
    return true;
  }

  // Armour and the defuse kit. A helmet on top of a full vest costs the
  // difference. Gear isn't sold back.
  _buyGear(p, item) {
    if (!this.canBuy(p)) return 'cannot-buy';
    let price = item.price;
    if (item.id === 'kit') {
      if (this.mode !== MODE_BOMB || p.team === this.game.attackers) return 'not-for-sale';
      if (p.kit) return 'owned';
    } else if (item.id === 'vest') {
      if (p.armor >= MAX_ARMOR) return 'owned';
    } else {
      if (p.armor >= MAX_ARMOR && p.helmet) return 'owned';
      if (p.armor >= MAX_ARMOR) price = EQUIPMENT.vesthelm.price - EQUIPMENT.vest.price;
    }
    const cost = this.freeBuy ? 0 : price;
    if (p.money < cost) return 'no-money';
    p.money -= cost;
    if (item.id === 'kit') p.kit = true;
    else {
      p.armor = MAX_ARMOR;
      if (item.id === 'vesthelm') p.helmet = true;
    }
    return true;
  }

  // Sells back a weapon bought this round, for what was paid. Returns true,
  // or why not.
  sell(id, weaponId) {
    const p = this.players.get(id);
    if (!p) return 'no-player';
    if (typeof weaponId !== 'string' || !Object.hasOwn(WEAPONS, weaponId)) return 'bad-weapon';
    const slot = WEAPONS[weaponId].slot;
    const gun = p.loadout[slot];
    if (!gun || gun.id !== weaponId || !gun.bought) return 'not-sellable';
    if (!this.canBuy(p)) return 'cannot-buy';
    p.money = Math.min(MAX_MONEY, p.money + gun.paid);
    p.loadout[slot] = gun.prev || (slot === SECONDARY ? makeGun(DEFAULT_SECONDARY) : null);
    if (p.slot === slot) {
      if (!p.loadout[slot]) p.slot = SECONDARY;
      this._draw(p);
    }
    return true;
  }

  // Starts drawing the held weapon: no reload, no shots until it's up.
  _draw(p) {
    p.reloadStart = -1;
    p.drawEnd = p.steps + TIMING[p.gun.id].draw;
  }

  _switch(p, slot) {
    if (p.dead || !p.loadout[slot]) return;
    p.slot = slot;
    this._draw(p);
  }

  // Shots/reloads/switches due before input `seq` is applied.
  _runActions(p, seq) {
    if (!p.actions.length) return;
    let keep = 0;
    for (let i = 0; i < p.actions.length; i++) {
      const a = p.actions[i];
      if (a.seq > seq) {
        p.actions[keep++] = a;
        continue;
      }
      if (a.shot) this._fire(p, a.shot);
      else if (a.reload) this._reload(p);
      else this._switch(p, a.slot);
    }
    p.actions.length = keep;
  }

  _reload(p) {
    const gun = p.gun;
    if (p.dead || p.reloadStart >= 0 || gun.ammo >= WEAPONS[gun.id].mag || gun.reserve <= 0) return;
    p.reloadStart = p.steps;
  }

  _fire(p, shot) {
    if (p.dead) return;
    if (this.frozen) {
      p.rejected++;
      return;
    }
    const m = p.move;
    const gun = p.gun;
    const w = WEAPONS[gun.id];
    const reloading = p.reloadStart >= 0;
    const drawing = p.steps < p.drawEnd;
    const eyeDist = Math.hypot(shot.origin.x - m.pos.x, shot.origin.y - (m.pos.y + m.eye), shot.origin.z - m.pos.z);
    if (reloading || drawing || gun.ammo <= 0 || p.steps - p.lastFire < TIMING[gun.id].fire || eyeDist > MAX_MUZZLE_OFFSET) {
      p.rejected++;
      return;
    }
    gun.ammo--;
    p.lastFire = p.steps;

    // lag compensation: everyone else as the shooter saw them. The newest
    // recorded tick is the previous one (this tick is still being simulated).
    const newest = this.tick - 1;
    const viewTick = Math.max(newest - MAX_REWIND_TICKS, Math.min(newest, shot.viewTick));
    const boxes = this._boxes;
    boxes.length = 0;
    for (const other of this.players.values()) {
      if (other === p || other.dead) continue;
      if (p.team >= 0 && other.team === p.team) continue; // no friendly fire: rounds pass through
      if (this._rewind(other, viewTick)) boxes.push(other.hitbox);
    }
    this.world.dynamics = boxes;
    const hit = traceShot(this.world, shot.origin, shot.dir);
    this.world.dynamics = [];

    const o = shot.origin;
    const end = hit ? hit.point : shotEndpoint(o, shot.dir, 200, this._end);
    this._emit([EV_SHOT, p.id, r3(o.x), r3(o.y), r3(o.z), r3(end.x), r3(end.y), r3(end.z), weaponIndex(gun.id)]);
    if (!hit || !hit.box || !hit.box.owner) return;

    const target = hit.box.owner;
    const headshot = isHeadshot(hit.box, hit.point.y);
    const hitArmor = applyArmor(headshot ? w.head : w.body, w.armorPen, target.armor, target.helmet, headshot);
    const damage = hitArmor.health;
    target.armor -= hitArmor.armor;
    if (target.armor <= 0) target.helmet = false;
    target.hp = Math.max(0, target.hp - damage);
    this._emit([EV_HIT, p.id, target.id, damage, headshot ? 1 : 0, r3(hit.point.x), r3(hit.point.y), r3(hit.point.z)]);
    if (target.hp === 0) this._kill(target, p, headshot, gun.id);
  }

  // `killer` null means the world (fell off the map): a death, no kill credit.
  // `weaponId` 'bomb': killed by the explosion.
  _kill(target, killer, headshot, weaponId = null) {
    target.hp = 0;
    target.dead = true;
    target.respawnTick = this.respawning ? this.tick + RESPAWN_TICKS : Infinity;
    target.reloadStart = -1;
    target.deaths++;
    // the dead lose their gear, and drop the bomb
    target.armor = 0;
    target.helmet = false;
    target.kit = false;
    target.useKind = USE_NONE;
    target.useSteps = 0;
    this._dropIfCarrier(target);
    if (killer) {
      killer.kills++;
      if (weaponId) this._pay(killer, WEAPONS[weaponId].killReward);
    }
    const how = weaponId === 'bomb' ? KILL_BY_BOMB : weaponId ? weaponIndex(weaponId) : -1;
    this._emit([EV_KILL, killer ? killer.id : 0, target.id, headshot ? 1 : 0, how]);
  }

  // ---- the bomb ----

  // Round start: a random attacker carries it.
  _giveBomb() {
    const g = this.game;
    const attackers = [...this.players.values()].filter((p) => p.team === g.attackers && !p.dead);
    if (!attackers.length) {
      g.bomb = null;
      return;
    }
    const carrier = attackers[this._rng.nextUint32() % attackers.length];
    g.bomb = { state: BOMB_CARRIED, carrier: carrier.id, x: 0, y: 0, z: 0, site: '', explodeAt: 0, defuser: 0, planted: false };
  }

  _dropIfCarrier(p) {
    const b = this.game.bomb;
    if (!b || b.state !== BOMB_CARRIED || b.carrier !== p.id) return;
    const pos = p.move.pos;
    b.state = BOMB_DROPPED;
    b.carrier = 0;
    b.x = pos.x;
    b.y = Math.max(pos.y, KILL_Y + 1); // fell off the map: it stays reachable-ish
    b.z = pos.z;
    this._emit([EV_BOMB, BOMBEV_DROPPED, p.id, '']);
  }

  // Use held by p this input step: plant (the carrier, standing still in a
  // site) or defuse (a defender, standing still beside the planted bomb).
  // Moving, jumping or letting go starts it over.
  _bombUse(p, input) {
    const g = this.game;
    const b = g.bomb;
    const still = input.use && input.forward === 0 && input.right === 0 && !input.jump && p.move.grounded;
    const pos = p.move.pos;
    if (!b || g.phase !== PHASE_LIVE || !still) {
      this._stopUse(p);
      return;
    }
    if (p.team === g.attackers) {
      const site = b.state === BOMB_CARRIED && b.carrier === p.id ? siteAt(this.sites, pos.x, pos.z) : null;
      if (!site) return this._stopUse(p);
      if (p.useKind !== USE_PLANT) {
        p.useKind = USE_PLANT;
        p.useSteps = 0;
      }
      if (++p.useSteps >= this.rules.plantTicks) this._plant(p, site);
      return;
    }
    const near = b.state === BOMB_PLANTED && Math.hypot(pos.x - b.x, pos.z - b.z) <= DEFUSE_RADIUS && Math.abs(pos.y - b.y) < 2;
    if (!near || (b.defuser && b.defuser !== p.id)) return this._stopUse(p);
    if (p.useKind !== USE_DEFUSE) {
      p.useKind = USE_DEFUSE;
      p.useSteps = 0;
      b.defuser = p.id;
    }
    if (++p.useSteps >= (p.kit ? this.rules.kitDefuseTicks : this.rules.defuseTicks)) this._defuse(p);
  }

  _stopUse(p) {
    const b = this.game.bomb;
    if (b && b.defuser === p.id) b.defuser = 0;
    p.useKind = USE_NONE;
    p.useSteps = 0;
  }

  _plant(p, site) {
    const g = this.game;
    const b = g.bomb;
    const pos = p.move.pos;
    Object.assign(b, { state: BOMB_PLANTED, carrier: 0, x: pos.x, y: pos.y, z: pos.z, site, planted: true });
    b.explodeAt = this.tick + this.rules.bombTicks;
    g.endsAt = b.explodeAt; // the round clock becomes the bomb's
    this._stopUse(p);
    this._pay(p, PLANT_REWARD);
    this._emit([EV_BOMB, BOMBEV_PLANTED, p.id, site]);
  }

  _defuse(p) {
    const b = this.game.bomb;
    b.state = BOMB_DEFUSED;
    this._stopUse(p);
    this._pay(p, DEFUSE_REWARD);
    this._emit([EV_BOMB, BOMBEV_DEFUSED, p.id, b.site]);
    this._endRound(1 - this.game.attackers, END_DEFUSED);
  }

  // Each tick: pick-ups of a dropped bomb, and the explosion.
  _updateBomb() {
    const g = this.game;
    const b = g.bomb;
    if (!b || g.phase !== PHASE_LIVE) return;
    if (b.state === BOMB_DROPPED) {
      for (const p of this.players.values()) {
        if (p.dead || p.team !== g.attackers) continue;
        const pos = p.move.pos;
        if (Math.hypot(pos.x - b.x, pos.z - b.z) <= PICKUP_RADIUS && Math.abs(pos.y - b.y) < 2) {
          b.state = BOMB_CARRIED;
          b.carrier = p.id;
          this._emit([EV_BOMB, BOMBEV_PICKED, p.id, '']);
          break;
        }
      }
    } else if (b.state === BOMB_PLANTED && this.tick >= b.explodeAt) {
      b.state = BOMB_EXPLODED;
      this._emit([EV_BOMB, BOMBEV_EXPLODED, 0, b.site]);
      for (const p of this.players.values()) {
        if (p.dead) continue;
        const pos = p.move.pos;
        const damage = bombDamage(Math.hypot(pos.x - b.x, pos.y + 0.9 - b.y, pos.z - b.z));
        if (damage <= 0) continue;
        p.hp = Math.max(0, p.hp - damage);
        if (p.hp === 0) this._kill(p, null, false, 'bomb');
      }
      this._endRound(g.attackers, END_BOMB);
    }
  }

  // Positions `p.hitbox` where p was at `tick` (interpolated). False if p was
  // dead then.
  _rewind(p, tick) {
    const t0 = Math.floor(tick);
    const a = p.history[t0 % HISTORY];
    const b = p.history[(t0 + 1) % HISTORY];
    if (a.tick !== t0) {
      // no record for that tick (joined since): use where they are now
      const m = p.move;
      playerHitbox(m.pos.x, m.pos.y, m.pos.z, m.half.y, p.hitbox);
      return true;
    }
    if (!a.alive) return false;
    const f = b.tick === t0 + 1 && b.alive ? tick - t0 : 0;
    playerHitbox(
      a.x + (b.x - a.x) * f,
      a.y + (b.y - a.y) * f,
      a.z + (b.z - a.z) * f,
      a.halfY + (b.halfY - a.halfY) * f,
      p.hitbox,
    );
    return true;
  }

  _record(p) {
    const h = p.history[this.tick % HISTORY];
    const m = p.move;
    h.tick = this.tick;
    h.x = m.pos.x;
    h.y = m.pos.y;
    h.z = m.pos.z;
    h.halfY = m.half.y;
    h.alive = !p.dead;
  }

  _respawn(p) {
    const [x, z] = this._spawnPoint(p);
    this._revive(p, x, z);
    this._emit([EV_SPAWN, p.id]);
  }

  // The spawn (from the player's team side, or anywhere in deathmatch)
  // farthest from every living opponent.
  _spawnPoint(p) {
    const spawns = p.team >= 0 ? this._sideSpawns(p.team) : this.spawns;
    let best = spawns[0];
    let bestD = -1;
    for (const s of spawns) {
      let d = Infinity;
      for (const o of this.players.values()) {
        if (o === p || o.dead || (p.team >= 0 && o.team === p.team)) continue;
        d = Math.min(d, Math.hypot(o.move.pos.x - s[0], o.move.pos.z - s[1]));
      }
      if (d > bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  _revive(p, x, z) {
    this._place(p, x, z);
    p.hp = MAX_HEALTH;
    p.dead = false;
    // full ammo; this round's purchases are now kept for good
    p.loadout = p.loadout.map((gun) => gun && makeGun(gun.id));
    p.slot = defaultSlot(p.loadout);
    p.reloadStart = -1;
    p.lastFire = -Infinity;
    p.drawEnd = 0;
    p.spawns++;
  }

  // Fresh movement state at a spawn, settled onto the ground with one idle
  // step (not a client input) so snapshots show the player standing.
  _place(p, x, z) {
    const yaw = p.move ? p.move.yaw : Math.PI;
    p.move = createMoveState({ x, y: SPAWN_HEIGHT, z }, { x: 0, y: 0, z: 0 });
    p.move.yaw = yaw;
    stepMove(p.move, IDLE, H, this.world, this._out);
  }

  _emit(data) {
    this.events.push({ n: ++this._eventN, tick: this.tick, data });
  }

  _trimEvents() {
    // events older than a second have been delivered to every live client
    let drop = 0;
    while (drop < this.events.length && this.events[drop].tick < this.tick - TICK_RATE) drop++;
    if (drop) this.events.splice(0, drop);
  }

  _buyFlags(p) {
    return (
      (this.canBuy(p) ? BUY_OPEN : 0) |
      (this.freeBuy ? BUY_FREE : 0) |
      (p.loadout[PRIMARY] && p.loadout[PRIMARY].bought ? BUY_SELL_PRIMARY : 0) |
      (p.loadout[SECONDARY].bought ? BUY_SELL_SECONDARY : 0)
    );
  }

  _useProgress(p) {
    if (p.useKind === USE_NONE) return 0;
    const need = p.useKind === USE_PLANT ? this.rules.plantTicks : p.kit ? this.rules.kitDefuseTicks : this.rules.defuseTicks;
    return Math.round((p.useSteps / need) * 100) / 100;
  }

  // The bomb as `viewer` may know it: defenders aren't told who carries it.
  _bombFor(viewer) {
    const b = this.game.bomb;
    if (!b) return null;
    if (b.state === BOMB_CARRIED) {
      if (viewer.team !== this.game.attackers) return [BOMB_CARRIED, 0, 0, 0, '', 0];
      const c = this.players.get(b.carrier);
      const pos = c ? c.move.pos : b;
      return [BOMB_CARRIED, r3(pos.x), r3(pos.y), r3(pos.z), '', b.carrier];
    }
    return [b.state, r3(b.x), r3(b.y), r3(b.z), b.site, 0];
  }

  _gameState(viewer) {
    const g = this.game;
    return [
      g.phase, g.endsAt, g.round, g.score[0], g.score[1], g.lastWinner, this.rules.roundsToWin, this.mode === MODE_DM ? 1 : 0, g.buyUntil,
      g.attackers, this._bombFor(viewer), this.mode,
    ];
  }

  // Snapshot for one recipient: their exact state, their combat status,
  // everyone else, and the events they haven't seen. Advances the
  // recipient's event cursor.
  snapshotFor(id) {
    const me = this.players.get(id);
    if (!me) return null;
    const players = [];
    for (const p of this.players.values()) {
      if (p.id === id) continue;
      const m = p.move;
      players.push([
        p.id,
        r3(m.pos.x), r3(m.pos.y), r3(m.pos.z),
        r3(m.yaw), r3(p.pitch),
        (m.crouching ? PL_CROUCH : 0) | (m.grounded ? PL_GROUNDED : 0) | (p.dead ? PL_DEAD : 0),
        p.name,
        p.kills,
        p.deaths,
        p.team,
        p.gun.id,
      ]);
    }
    const ev = [];
    for (const e of this.events) {
      if (e.n <= me.eventsSeen) continue;
      if (e.data[0] === EV_SHOT && e.data[1] === id) continue; // drew it locally
      ev.push(e.data);
    }
    me.eventsSeen = this._eventN;
    return {
      t: 'snap',
      tick: this.tick,
      ack: me.lastSeq,
      you: packState(me.move),
      me: [
        me.hp, me.dead ? 1 : 0, me.ammo, me.reserve, me.kills, me.deaths, me.spawns, me.team,
        me.money, me.slot, packGun(me.loadout[PRIMARY]), packGun(me.loadout[SECONDARY]), this._buyFlags(me),
        me.armor, me.helmet ? 1 : 0, me.kit ? 1 : 0, me.useKind, this._useProgress(me),
      ],
      players,
      game: this._gameState(me),
      ev,
    };
  }
}

const packGun = (gun) => (gun ? [gun.id, gun.ammo, gun.reserve] : null);

// Others are only drawn, so millimetres are plenty.
const r3 = (v) => Math.round(v * 1000) / 1000;
