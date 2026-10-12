// core/prewarm.js — compile every material before the first visible frame so
// gameplay never hitches on a lazy shader compile mid-frame.
//
// Contract: subsystems implementing prewarmMaterials(ctx) build and compile
// every material they can produce WITHOUT spawning gameplay objects, drawing a
// gameplay frame, or touching the clock/RNG.

export async function prewarm(ctx) {
  const mark = (step) => {
    window.__owPrewarm = step;
    if (ctx.config.debug) console.log(`[prewarm] ${step}`);
  };
  mark('start');
  for (const s of ctx.systems()) {
    if (typeof s.prewarmMaterials === 'function') {
      await s.prewarmMaterials(ctx);
    }
  }
  mark('subsystems');
  // Warm the forward-lit variants of every material in the world scene.
  const render = ctx.peek('render');
  if (render && render.renderer) {
    try {
      await render.renderer.compileAsync(ctx.scene, ctx.camera);
    } catch (err) {
      console.error('[prewarm] compileAsync failed:', err);
    }
    mark('world-compile');
    // Render one hidden frame into the HDR target so shadow-depth materials
    // and the sky dome compile before the loading overlay lifts. No gameplay
    // objects are spawned and the clock/RNG are untouched.
    try {
      render.renderer.setRenderTarget(render.hdrRT);
      render.renderer.render(ctx.scene, ctx.camera);
      render.renderer.setRenderTarget(null);
    } catch (err) {
      console.error('[prewarm] hidden frame failed:', err);
    }
    mark('hidden-frame');
    // Compile the first-person view pipeline (viewmodel materials + the
    // VIEW_FRAG composite) too, so the weapon appears without a lazy hit.
    // warmView() renders the view scene for real (synchronous), which both
    // compiles every viewmodel program and produces the actual first frame —
    // safer than a second async compileAsync under software WebGL.
    if (ctx.viewScene && ctx.viewScene.children.length) {
      try {
        render.warmView(ctx);
      } catch (err) {
        console.error('[prewarm] warmView failed:', err);
      }
      mark('view-warm');
    }
  }
  mark('done');
}
