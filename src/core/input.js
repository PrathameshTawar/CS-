// core/input.js — keyboard + pointer-lock mouse, polled once per frame.
// `input.beginFrame()` is called by the engine at the top of every frame.

const KEYMAP = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['ControlLeft', 'ControlRight'],
  jump: ['Space'],
  reload: ['KeyR'],
  leanLeft: ['KeyQ'],
  leanRight: ['KeyE'],
  interact: ['KeyF'],
  inspect: ['KeyX'],
  use: ['KeyG'],
};

export function createInput(ctx) {
  const keysDown = new Set();
  const actions = new Set();
  const actionsPressed = new Set();
  const buttons = { fire: false, ads: false, firePressed: false, adsPressed: false };
  const aim = { dx: 0, dy: 0, sensitivity: 1 };
  const _aimOut = { dx: 0, dy: 0 }; // reused to avoid per-frame allocation
  let locked = false;
  const canvas = ctx.canvas;

  const actionOf = (code) => {
    for (const [name, codes] of Object.entries(KEYMAP)) {
      if (codes.includes(code)) return name;
    }
    return null;
  };

  const onKeyDown = (e) => {
    if (e.code === 'Escape' || e.code === 'Tab') return;
    const a = actionOf(e.code);
    if (a) {
      if (!keysDown.has(e.code)) actionsPressed.add(a);
      keysDown.add(e.code);
      actions.add(a);
      e.preventDefault();
    }
  };
  const onKeyUp = (e) => {
    keysDown.delete(e.code);
    const a = actionOf(e.code);
    if (a) actions.delete(a);
  };
  const onMouseMove = (e) => {
    if (locked) {
      aim.dx += e.movementX;
      aim.dy += e.movementY;
    }
  };
  const onMouseDown = (e) => {
    if (!locked) {
      lock(); // the engage click must not also fire a shot
      return;
    }
    if (e.button === 0) {
      buttons.fire = true;
      buttons.firePressed = true;
    } else if (e.button === 2) {
      buttons.ads = true;
      buttons.adsPressed = true;
    }
  };
  const onMouseUp = (e) => {
    if (e.button === 0) buttons.fire = false;
    else if (e.button === 2) buttons.ads = false;
  };
  const onContextMenu = (e) => e.preventDefault();
  const onLockChange = () => {
    locked = document.pointerLockElement === canvas;
  };

  function lock() {
    if (!locked) canvas.requestPointerLock();
  }
  function unlock() {
    if (locked) document.exitPointerLock();
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('pointerlockchange', onLockChange);

  const api = {
    get locked() {
      return locked;
    },
    get fire() {
      return buttons.fire;
    },
    get ads() {
      return buttons.ads;
    },
    lock,
    unlock,
    isDown(name) {
      return actions.has(name);
    },
    justPressed(name) {
      return actionsPressed.has(name);
    },
    firePressed() {
      return buttons.firePressed;
    },
    adsPressed() {
      return buttons.adsPressed;
    },
    consumeAim() {
      _aimOut.dx = aim.dx * aim.sensitivity;
      _aimOut.dy = aim.dy * aim.sensitivity;
      return _aimOut;
    },
    beginFrame() {
      actionsPressed.clear();
      buttons.firePressed = false;
      buttons.adsPressed = false;
      aim.dx = 0;
      aim.dy = 0;
    },
    dispose() {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('pointerlockchange', onLockChange);
    },
  };
  return api;
}
