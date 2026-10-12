// core/events.js — the cross-subsystem event bus.
// Payloads are plain objects. See ARCHITECTURE.md for the canonical event set
// (weapon:fire, bullet:impact, damage:dealt, actor:death, resize, ...).

export class EventBus {
  constructor() {
    this._map = new Map();
  }

  on(event, fn, priority = 0) {
    let list = this._map.get(event);
    if (!list) {
      list = [];
      this._map.set(event, list);
    }
    list.push({ fn, priority });
    list.sort((a, b) => b.priority - a.priority);
    return () => this.off(event, fn);
  }

  once(event, fn) {
    let off = null;
    off = this.on(event, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off(event, fn) {
    const list = this._map.get(event);
    if (!list) return;
    const i = list.findIndex((e) => e.fn === fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit(event, payload) {
    const list = this._map.get(event);
    if (!list) return;
    for (const { fn } of list.slice()) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] handler for '${event}' threw:`, err);
      }
    }
  }

  clear() {
    this._map.clear();
  }
}
