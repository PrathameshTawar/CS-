// main.js — boot sequence. Owned by the lead (do not edit without the lead).
//
// Order: resolve config -> build context -> register systems -> init in
// dependency order -> prewarm shaders -> start the loop. The loading overlay
// covers the whole boot; `window.__owBooted` is set on the first frame so
// tools/capture.mjs can poll for a stable frame.

import { resolveConfig } from './core/config.js';
import { Context } from './core/ctx.js';
import { prewarm } from './core/prewarm.js';
import { RenderSystem } from './render/index.js';
import { MaterialsSystem } from './materials/index.js';
import { SkySystem } from './sky/index.js';
import { WorldSystem } from './world/index.js';
import { PhysicsSystem } from './physics/index.js';
import { FxSystem } from './fx/index.js';
import { PlayerSystem } from './player/index.js';
import { WeaponSystem } from './weapons/index.js';
import { AiSystem } from './ai/index.js';
import { AudioSystem } from './audio/index.js';
import { UiSystem } from './ui/index.js';
import { DevSystem } from './dev/index.js';
import { ShotRigSystem } from './shotrig/index.js';

const barEl = document.getElementById('bootbar');
function progress(p) {
  if (barEl) barEl.style.width = `${Math.min(100, p)}%`;
}

async function boot() {
  const overlay = document.getElementById('boot');
  try {
    const config = resolveConfig();
    window.__owPhase = 'boot';
    progress(8);
    const ctx = new Context(document.getElementById('game'), config);
    ctx.register(
      new RenderSystem(),
      new MaterialsSystem(),
      new SkySystem(),
      new WorldSystem(),
      new PhysicsSystem(),
      new FxSystem(),
      new PlayerSystem(),
      new WeaponSystem(),
      new AiSystem(),
      new AudioSystem(),
      new UiSystem(),
      new DevSystem(),
    );
    // deterministic capture rig — only active when ?shot=<name> is present
    if (config.shot) ctx.register(new ShotRigSystem());
    progress(18);
    await ctx.boot();
    window.__owPhase = 'prewarm';
    progress(66);
    await prewarm(ctx);
    window.__owPhase = 'start';
    progress(88);
    ctx.start();
    progress(100);
    requestAnimationFrame(() => {
      window.__owPhase = 'running';
      window.__owBooted = performance.now();
    });
    setTimeout(() => {
      if (overlay) {
        // shot mode: drop the boot overlay instantly so it can never appear
        // in a captured frame.
        if (config.shot) {
          overlay.remove();
        } else {
          overlay.style.opacity = '0';
          setTimeout(() => overlay.remove(), 700);
        }
      }
    }, config.shot ? 0 : 400);
    window.ctx = ctx; // debug handle
  } catch (err) {
    console.error(err);
    window.__owPhase = 'error';
    if (overlay) {
      overlay.classList.add('err');
      overlay.innerHTML = `<h1>BOOT FAILED</h1><p class="sub">${String((err && err.message) || err)}</p>`;
    }
  }
}

boot();
