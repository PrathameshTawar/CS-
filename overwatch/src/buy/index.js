// buy/index.js — the buy menu (B), money and the buy-time hint.
//
// Online, the server decides: the menu sends buy/sell requests through net
// and shows what the snapshots say (money, what you own, whether you can
// still buy, what can be sold back). Team rounds charge money and allow
// buying during the freeze and buy time near your spawn; warmup and
// deathmatch are free. In single player everything is free, any time.
//
// While the menu is open the mouse is released so you can click; 1-4 buy
// too. B closes it and takes the mouse back; Esc just closes it.

import { BUY_FREE, BUY_SELL_PRIMARY, BUY_SELL_SECONDARY, MODE_BOMB, TICK_RATE } from '../../shared/protocol.js';
import { EQUIPMENT, MAX_ARMOR, PRIMARY, SECONDARY, WEAPONS } from '../../shared/weapons.js';

// menu rows, in key order; gear (armour, the defuse kit) only online
const ITEMS = [
  { id: 'heavy', group: 'PISTOLS' },
  { id: 'smg', group: 'SMGS' },
  { id: 'rifle', group: 'RIFLES' },
  { id: 'sniper', group: 'SNIPER RIFLES' },
  { id: 'vest', group: 'GEAR', gear: true },
  { id: 'vesthelm', group: 'GEAR', gear: true },
  { id: 'kit', group: 'GEAR', gear: true },
];
const defOf = (id) => WEAPONS[id] || EQUIPMENT[id];

export class BuySystem {
  static id = 'buy';
  static deps = ['weapons', 'player'];

  init(ctx) {
    this.ctx = ctx;
    this.weapons = ctx.get('weapons');
    this.player = ctx.get('player');
    this.open = false;
    if (ctx.config.shot) return; // headless captures draw no UI
    this._build();
    this._onKey = (e) => {
      if (!this.open) return;
      if (e.code === 'Escape') {
        // close only: don't let the pause menu see this Escape too
        e.stopPropagation();
        this.close(false);
        return;
      }
      const n = /^Digit([1-9])$/.exec(e.code);
      const items = this._items();
      if (n && items[n[1] - 1]) {
        e.preventDefault();
        this._choose(items[n[1] - 1].id, false);
      }
    };
    document.addEventListener('keydown', this._onKey, true);
    // clicked back into the game view: the menu is done
    this._onLock = () => {
      if (this.open && document.pointerLockElement === ctx.canvas) this.close(false);
    };
    document.addEventListener('pointerlockchange', this._onLock);
  }

  get _net() {
    return this.ctx.peek('net');
  }

  // Can we buy right now? Online: the server's word. Offline: when alive.
  canBuy() {
    const net = this._net;
    if (net) return net.canBuy;
    return !this.player.dead;
  }

  // Purchases are free in single player, warmup and deathmatch.
  get free() {
    const net = this._net;
    return !net || (net.buyFlags & BUY_FREE) !== 0;
  }

  get money() {
    const net = this._net;
    return net ? net.money : 0;
  }

  // What's on sale to us: gear only online, the kit only to Bomb Defusal defenders.
  _items() {
    const net = this._net;
    return ITEMS.filter((item) => {
      if (!item.gear) return true;
      if (!net) return false;
      return item.id !== 'kit' || (net.mode === MODE_BOMB && net.team !== net.attackers);
    });
  }

  // A helmet on top of a full vest costs the difference (as on the server).
  _price(id) {
    const net = this._net;
    if (id === 'vesthelm' && net && net.armor >= MAX_ARMOR) return EQUIPMENT.vesthelm.price - EQUIPMENT.vest.price;
    return defOf(id).price;
  }

  _sellable(id) {
    const net = this._net;
    if (!net || !WEAPONS[id]) return false;
    const slot = WEAPONS[id].slot;
    const gun = this.weapons.loadout[slot];
    const flag = slot === PRIMARY ? BUY_SELL_PRIMARY : BUY_SELL_SECONDARY;
    return !!gun && gun.id === id && (net.buyFlags & flag) !== 0;
  }

  _owned(id) {
    const net = this._net;
    if (id === 'vest') return !!net && net.armor >= MAX_ARMOR;
    if (id === 'vesthelm') return !!net && net.armor >= MAX_ARMOR && net.helmet;
    if (id === 'kit') return !!net && net.kit;
    const gun = this.weapons.loadout[WEAPONS[id].slot];
    return !!gun && gun.id === id;
  }

  toggle() {
    if (this.open) this.close(true);
    else this.show();
  }

  show() {
    if (this.open || !this.canBuy()) return;
    this.open = true; // before releasing the mouse: the pause menu checks it
    this._render(true);
    this._panel.style.display = 'block';
    document.exitPointerLock();
  }

  close(relock) {
    if (!this.open) return;
    this.open = false;
    this._panel.style.display = 'none';
    if (relock && document.pointerLockElement !== this.ctx.canvas) this.ctx.canvas.requestPointerLock();
  }

  _choose(id, sell) {
    if (!this.canBuy()) return;
    const net = this._net;
    if (sell) {
      if (this._sellable(id)) net.sell(id);
      return;
    }
    if (this._owned(id)) return;
    if (!net) {
      this.weapons.give(id);
      return;
    }
    if (this.free || this.money >= this._price(id)) net.buy(id);
  }

  update(dt, ctx) {
    if (ctx.config.shot) return;
    const inp = ctx.input;
    // B in play (mouse captured) opens; B in the menu closes (see _onKey for Esc)
    if (inp.justPressed('buy') && (this.open || inp.locked)) this.toggle();
    if (this.open && !this.canBuy()) this.close(false); // buy time ran out, or we died
    if (this.open) this._render(false);
    this._renderHud();
  }

  // ---- DOM ----

  _build() {
    const panel = document.createElement('div');
    panel.id = 'buy-menu';
    panel.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:40;display:none;min-width:360px;' +
      'background:rgba(10,14,22,.92);border:1px solid rgba(120,150,190,.35);border-radius:8px;padding:16px 18px;' +
      'font:13px/1.4 ui-monospace,Consolas,monospace;color:#e6ebf2;box-shadow:0 10px 40px rgba(0,0,0,.6);';
    panel.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-buy],[data-sell]');
      if (!btn) return;
      if (btn.dataset.sell) this._choose(btn.dataset.sell, true);
      else this._choose(btn.dataset.buy, false);
    });
    document.body.appendChild(panel);
    this._panel = panel;
    this._key = '';

    const hud = document.createElement('div');
    hud.style.cssText =
      'position:fixed;right:24px;bottom:150px;z-index:30;text-align:right;pointer-events:none;' +
      'font:600 13px/1.4 ui-monospace,Consolas,monospace;text-shadow:0 1px 3px rgba(0,0,0,.9);';
    document.body.appendChild(hud);
    this._hud = hud;
    this._hudKey = '';
  }

  // Rebuilds the menu only when what it shows changes.
  _render(force) {
    const net = this._net;
    const money = this.money;
    const free = this.free;
    const loadout = this.weapons.loadout;
    const gear = net ? [net.armor, net.helmet, net.kit, net.team, net.attackers, net.mode] : [];
    const key = [money, free, net ? net.buyFlags : 0, loadout[PRIMARY] && loadout[PRIMARY].id, loadout[SECONDARY].id, ...gear].join('|');
    if (!force && key === this._key) return;
    this._key = key;
    const items = this._items();
    const rows = items.map((item, i) => {
      const w = defOf(item.id);
      const owned = this._owned(item.id);
      const sellable = this._sellable(item.id);
      const cost = this._price(item.id);
      const afford = free || money >= cost;
      const price = free ? 'FREE' : `$${cost}`;
      const right = sellable
        ? `<span data-sell="${item.id}" style="cursor:pointer;color:#ffb35c;border:1px solid #ffb35c;border-radius:3px;padding:1px 6px">SELL +$${free ? 0 : w.price}</span>`
        : owned
          ? '<span style="color:#7fe08a">OWNED</span>'
          : `<span style="color:${afford ? '#e6ebf2' : '#a55'}">${price}</span>`;
      const clickable = !owned && afford;
      return (
        (i && items[i - 1].group === item.group ? '<div style="height:4px"></div>' :
          `<div style="color:#7f8ea3;font-size:11px;letter-spacing:1px;margin-top:${i ? 10 : 0}px">${item.group}</div>`) +
        `<div ${clickable ? `data-buy="${item.id}"` : ''} style="display:flex;justify-content:space-between;gap:24px;padding:6px 8px;` +
        `border-radius:4px;background:${owned ? 'rgba(80,140,90,.18)' : 'rgba(255,255,255,.05)'};` +
        `cursor:${clickable ? 'pointer' : 'default'};opacity:${afford || owned ? 1 : 0.55}">` +
        `<span><b style="color:#ffd27a">${i + 1}</b>&nbsp; ${w.name}</span>${right}</div>`
      );
    });
    this._panel.innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">` +
      `<b style="font-size:15px;letter-spacing:2px">BUY</b>` +
      `<span style="color:#7fe08a;font-size:15px">${free ? 'FREE' : `$${money}`}</span></div>` +
      rows.join('') +
      `<div style="color:#7f8ea3;font-size:11px;margin-top:12px">Click or press 1–${items.length} · B to close and play</div>`;
  }

  // Money and the "press B" hint, online.
  _renderHud() {
    const net = this._net;
    let html = '';
    if (net && net.status === 'online') {
      const can = net.canBuy;
      const free = this.free;
      let timer = '';
      if (can && !free && net._lastSnap) {
        const left = Math.max(0, Math.ceil((net.buyUntil - net._lastSnap.tick) / TICK_RATE));
        timer = ` · ${left}s`;
      }
      const gear = [net.armor > 0 ? `ARMOR ${net.armor}${net.helmet ? ' + HELMET' : ''}` : '', net.kit ? 'KIT' : ''].filter(Boolean).join(' · ');
      html =
        (gear ? `<div style="color:#9fc4ff;font-size:12px">${gear}</div>` : '') +
        (free ? '' : `<div style="color:#7fe08a;font-size:18px">$${net.money}</div>`) +
        (can && !this.open ? `<div style="color:#ffd27a">B BUY${timer}</div>` : '');
    } else if (!net && !this.open && !this.player.dead) {
      html = '<div style="color:#8995a5;font-size:11px">B BUY · 1 / 2 SWITCH</div>';
    }
    if (html !== this._hudKey) {
      this._hudKey = html;
      this._hud.innerHTML = html;
    }
  }

  dispose() {
    if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
    if (this._onLock) document.removeEventListener('pointerlockchange', this._onLock);
    if (this._panel) this._panel.remove();
    if (this._hud) this._hud.remove();
  }
}
