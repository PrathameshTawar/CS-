// ui/controls.js — the controls card: shown once, the first time someone
// plays (remembered in localStorage), and on demand from the menus.

const SEEN_KEY = 'ow_controls_seen';

const KEYS = [
  ['W A S D', 'Move'],
  ['Mouse', 'Aim'],
  ['Left click', 'Shoot'],
  ['Right click', 'Aim down sights / scope'],
  ['Shift', 'Sprint'],
  ['C or Ctrl', 'Crouch'],
  ['Space', 'Jump'],
  ['R', 'Reload'],
  ['1 / 2 / wheel', 'Rifle / pistol'],
  ['4', 'Grenade (again: next type)'],
  ['B', 'Buy menu'],
  ['F (hold)', 'Plant / defuse the bomb'],
  ['Q / E', 'Lean'],
  ['Tab', 'Scoreboard'],
  ['Esc', 'Menu, settings, feedback'],
];

export function controlsSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // storage blocked: it shows again next time
  }
}

// Shows the card over the game. `play`: the button starts playing (and
// takes the mouse); otherwise it just closes. Resolves when closed.
export function showControls({ play = false, canvas = null } = {}) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'ow-menu-overlay active'; // (without active it's see-through and click-through)
    el.id = 'ow-controls';
    el.style.zIndex = '120';
    el.innerHTML = `
      <div class="ow-pause-dialog" style="max-width:560px;width:calc(100% - 32px);text-align:left;">
        <h2 class="ow-pause-title" style="text-align:center;">CONTROLS</h2>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 18px;margin:16px 0 20px;font-size:14px;">
          ${KEYS.map(([k, what]) => `<b style="color:#ffd27a;white-space:nowrap">${k}</b><span style="color:#cbd5e1">${what}</span>`).join('')}
        </div>
        <button class="ow-primary-btn" id="controls-ok" style="margin:0;">${play ? 'CLICK TO PLAY' : 'GOT IT'}</button>
      </div>`;
    document.body.appendChild(el);
    const close = () => {
      markSeen();
      el.remove();
      document.removeEventListener('keydown', onKey, true);
      // the click is a user gesture: it may take the mouse straight away
      if (play && canvas && document.pointerLockElement !== canvas) canvas.requestPointerLock();
      resolve();
    };
    const onKey = (e) => {
      if (e.code === 'Escape' || e.code === 'Enter') {
        e.stopPropagation();
        e.preventDefault();
        close();
      }
    };
    el.querySelector('#controls-ok').addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
  });
}
