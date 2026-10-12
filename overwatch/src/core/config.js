// core/config.js — quality presets + runtime config resolution.
// config.q is the active preset. Never exceed its budgets (shadows, particles,
// decals, lights, resolution).

export const QUALITY_PRESETS = {
  low: {
    label: 'LOW',
    resolutionScale: 0.6,
    maxDPR: 1,
    shadowMapSize: 1024,
    shadowCascades: 1,
    taa: false,
    gtao: false,
    ssr: false,
    volumetrics: false,
    motionBlur: false,
    bloom: true,
    particleBudget: 20000,
    decalBudget: 48,
    maxLights: 6,
    anisotropic: 2,
    fogDensity: 0.007,
  },
  medium: {
    label: 'MEDIUM',
    resolutionScale: 0.75,
    maxDPR: 1.5,
    shadowMapSize: 2048,
    shadowCascades: 2,
    taa: false,
    gtao: false,
    ssr: false,
    volumetrics: false,
    motionBlur: false,
    bloom: true,
    particleBudget: 60000,
    decalBudget: 96,
    maxLights: 8,
    anisotropic: 4,
    fogDensity: 0.0055,
  },
  high: {
    label: 'HIGH',
    resolutionScale: 1,
    maxDPR: 2,
    shadowMapSize: 4096,
    shadowCascades: 3,
    taa: true,
    gtao: true,
    ssr: false,
    volumetrics: false,
    motionBlur: true,
    bloom: true,
    particleBudget: 120000,
    decalBudget: 160,
    maxLights: 10,
    anisotropic: 8,
    fogDensity: 0.0045,
  },
  ultra: {
    label: 'ULTRA',
    resolutionScale: 1.25,
    maxDPR: 2,
    shadowMapSize: 4096,
    shadowCascades: 4,
    taa: true,
    gtao: true,
    ssr: true,
    volumetrics: true,
    motionBlur: true,
    bloom: true,
    particleBudget: 200000,
    decalBudget: 256,
    maxLights: 12,
    anisotropic: 16,
    fogDensity: 0.004,
  },
};

function pickPreset() {
  const w = Math.min(innerWidth, innerHeight);
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  if (w <= 800 || cores <= 2 || mem <= 2) return 'low';
  if (cores <= 4 || mem <= 4) return 'medium';
  if (cores >= 12 && mem >= 16) return 'ultra';
  return 'high';
}

export function resolveConfig() {
  const url = new URL(location.href);
  const q = (url.searchParams.get('q') || url.searchParams.get('quality') || '').toLowerCase();
  const quality = QUALITY_PRESETS[q] ? q : pickPreset();
  const timeOfDay = (url.searchParams.get('time') || 'golden').toLowerCase();
  const seed = Number(url.searchParams.get('seed')) || 0x5eed1234;
  const shot = (url.searchParams.get('shot') || '').toLowerCase();
  return {
    q: QUALITY_PRESETS[quality],
    quality,
    seed: seed >>> 0,
    timeOfDay: ['day', 'golden', 'dusk', 'night'].includes(timeOfDay) ? timeOfDay : 'golden',
    // Deterministic camera rig: `?shot=<name>` parks the camera at a fixed pose
    // (see src/shotrig) and freezes player physics + viewmodel animation so
    // headless captures are bit-identical run to run.
    shot: shot || null,
    exposure: Number(url.searchParams.get('exp')) || 1.0,
    fov: Number(url.searchParams.get('fov')) || 70,
    mouseSensitivity: Number(url.searchParams.get('sens')) || 0.0022,
    bloomStrength: Number(url.searchParams.get('bloom')) || 1.0,
    debug: url.searchParams.has('debug'),
  };
}
