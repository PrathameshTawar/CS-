// core/time.js — the engine clock.
//
// Subsystems read time.state and must NEVER read performance.now() directly:
// deterministic capture depends on the engine driving the clock. The rendered
// transform between two physics steps is interpolated with `alpha`.

export const FIXED_STEP = 1 / 120; // 120 Hz deterministic gameplay

export function createTime() {
  const state = {
    elapsed: 0, // scaled seconds since boot
    raw: 0, // unscaled seconds since boot
    dt: 1 / 60, // scaled delta for this frame
    fixed: FIXED_STEP,
    alpha: 1, // interpolation factor between physics steps
    scale: 1, // time scale
    frame: 0,
    _last: -1,
    _acc: 0,
  };

  // Advance the clock; returns the number of fixed steps to run this frame.
  function advance(now) {
    const last = state._last < 0 ? now : state._last;
    state._last = now;
    const rawDt = Math.min((now - last) / 1000, 0.25); // clamp long pauses
    state.raw += rawDt;
    state.dt = rawDt * state.scale;
    state.elapsed += state.dt;
    state._acc += state.dt;
    state.frame++;
    let steps = 0;
    while (state._acc >= FIXED_STEP && steps < 8) {
      state._acc -= FIXED_STEP;
      steps++;
    }
    state.alpha = Math.min(state._acc / FIXED_STEP, 1);
    return steps;
  }

  return { state, advance };
}
