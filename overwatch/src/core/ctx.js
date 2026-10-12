// core/ctx.js — the shared context + system registry.
//
// ctx is the ONLY way subsystems talk to each other. Never import another
// subsystem's module; reach it at runtime through ctx.get('id').

import * as THREE from 'three';
import { EventBus } from './events.js';
import { createTime } from './time.js';
import { createInput } from './input.js';
import { createRng } from './rng.js';

function topoSort(systems) {
  const byId = new Map();
  for (const s of systems.values()) byId.set(s.constructor.id, s);
  const done = new Set();
  const order = [];
  const visit = (sys, stack) => {
    const id = sys.constructor.id;
    if (done.has(id)) return;
    if (stack.has(id)) throw new Error(`circular dependency on '${id}'`);
    stack.add(id);
    for (const dep of sys.constructor.deps || []) {
      const d = byId.get(dep);
      if (!d) throw new Error(`system '${id}' depends on missing '${dep}'`);
      visit(d, stack);
    }
    stack.delete(id);
    done.add(id);
    order.push(sys);
  };
  for (const s of systems.values()) visit(s, new Set());
  return order;
}

export class Context {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(config.fov, 1, 0.05, 1000);
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(config.fov, 1, 0.01, 40);
    this.events = new EventBus();
    this.time = createTime();
    this.rng = createRng(config.seed);
    this.input = createInput(this);
    this._systems = new Map();
    this._order = [];
    this._running = false;
    this._raf = 0;
  }

  register(...systems) {
    for (const s of systems) this._systems.set(s.constructor.id, s);
    return this;
  }

  has(id) {
    return this._systems.has(id);
  }

  get(id) {
    const s = this._systems.get(id);
    if (!s) throw new Error(`system '${id}' is not registered`);
    return s;
  }

  peek(id) {
    return this._systems.get(id);
  }

  systems() {
    return this._order;
  }

  async boot() {
    this._order = topoSort(this._systems);
    for (const s of this._order) {
      if (s.init) {
        const start = performance.now();
        await s.init(this);
        if (this.config.debug) {
          console.log(`[boot] ${s.constructor.id} in ${(performance.now() - start).toFixed(0)}ms`);
        }
      }
    }
    this.resize(innerWidth, innerHeight);
    return this;
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
    for (const s of this._order) if (s.resize) s.resize(w, h, this);
    this.events.emit('resize', { width: w, height: h });
  }

  start() {
    if (this._running) return this;
    this._running = true;
    const loop = (now) => {
      if (!this._running) return;
      this._raf = requestAnimationFrame(loop);
      const steps = this.time.advance(now);
      this.input.beginFrame();
      const t = this.time.state;
      for (let i = 0; i < steps; i++) {
        for (const s of this._order) if (s.fixedUpdate) s.fixedUpdate(t.fixed, this);
      }
      // update() in dependency order; render goes last so it sees every transform.
      for (const s of this._order) {
        if (s.update && s.constructor.id !== 'render') s.update(t.dt, this);
      }
      const render = this._systems.get('render');
      if (render && render.update) render.update(t.dt, this);
      for (const s of this._order) if (s.lateUpdate) s.lateUpdate(t.dt, this);
    };
    this._raf = requestAnimationFrame(loop);
    return this;
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
  }
}
