// dev/index.js — development system: a read-only stats overlay + capture
// telemetry. The player now owns the camera (movement, look, FOV); this
// system only reports frame stats and exposes window.__ow for
// tools/capture.mjs to assert on.

export class DevSystem {
  static id = 'dev';
  static deps = ['render'];

  init(ctx) {
    this.ctx = ctx;
    this._frameAcc = 0;
    this._el = null;

    // shot mode: no DOM overlay (live fps text would break bit-identical
    // captures); the window.__ow telemetry below is still published.
    if (!ctx.config.shot) {
      const el = document.createElement('div');
      el.id = 'dev-stats';
      el.style.cssText =
        'position:fixed;left:12px;bottom:12px;z-index:20;font:11px/1.5 ui-monospace,Consolas,monospace;' +
        'color:#9fe8b0;background:rgba(0,0,0,.45);padding:6px 10px;border-radius:6px;' +
        'pointer-events:none;text-shadow:0 1px 2px #000;white-space:pre;';
      document.body.appendChild(el);
      this._el = el;
    }

    // telemetry consumed by tools/capture.mjs
    window.__ow = {
      phase: 'boot',
      fps: 0,
      ms: 0,
      draws: 0,
      tris: 0,
      ammo: 0,
      reserve: 0,
      reloading: false,
    };
  }

  update(dt, ctx) {
    const render = ctx.peek('render');
    const weapons = ctx.peek('weapons');

    window.__ow.phase = window.__owPhase || 'running';
    window.__ow.fps = Math.round(1 / Math.max(dt, 1e-4));
    window.__ow.ms = Math.round(dt * 1000);
    window.__ow.draws = render ? render.frameStats.calls : 0;
    window.__ow.tris = render ? render.frameStats.tris : 0;
    if (weapons) {
      window.__ow.ammo = weapons.ammo;
      window.__ow.reserve = weapons.reserve;
      window.__ow.reloading = weapons.reloading;
    }

    this._frameAcc += dt;
    if (this._frameAcc >= 0.5) {
      this._frameAcc = 0;
      if (this._el) {
        const ammo = weapons ? `${weapons.ammo} / ${weapons.reserve}${weapons.reloading ? ' [R]' : ''}` : '—';
        this._el.textContent =
          `fps ${window.__ow.fps}  |  ${window.__ow.ms} ms\n` +
          `draws ${window.__ow.draws}  tris ${(window.__ow.tris / 1e6).toFixed(2)}M\n` +
          `q:${ctx.config.quality}  time:${ctx.config.timeOfDay}\n` +
          `ammo ${ammo}`;
      }
    }
  }

  dispose() {
    if (this._el) this._el.remove();
  }
}
