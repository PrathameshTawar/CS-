// core/input.js — keyboard + pointer-lock mouse.
//
// Events accumulate between frames and are read during the frame:
// - per-frame readers (update): isDown, justPressed, firePressed, consumeAim.
//   The engine calls `endFrame()` once every system has run, which clears
//   this frame's presses and mouse movement.
// - fixed-step readers (fixedUpdate): isDown, stepPressed. A frame can run
//   zero fixed steps (above 120 fps), so step presses are cleared by
//   `endSteps()` only after a frame that ran at least one step; a press is
//   never lost between steps.
// - wheel(): mouse-wheel notches this frame (+1 down, -1 up), while locked.

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
  slot1: ['Digit1'], // primary
  slot2: ['Digit2'], // pistol
  grenade: ['Digit4'], // take out a grenade (again: the next type)
  buy: ['KeyB'],
};

export function createInput(ctx) {
  const keysDown = new Set();
  const actions = new Set();
  const actionsPressed = new Set(); // since the last endFrame()
  const stepPressed = new Set(); // since the last endSteps()
  const buttons = { fire: false, ads: false, firePressed: false, adsPressed: false };
  const aim = { dx: 0, dy: 0, sensitivity: 1 };
  let wheel = 0;
  const _aimOut = { dx: 0, dy: 0 }; // reused to avoid per-frame allocation
  let locked = false;
  const canvas = ctx.canvas;

  const actionOf = (code) => {
    for (const [name, codes] of Object.entries(KEYMAP)) {
      if (codes.includes(code)) return name;
    }
    return null;
  };

  // Typing into a text field (menu name, server address) is not gameplay:
  // don't treat it as actions and don't swallow the keystroke.
  const typing = (e) => {
    const t = e.target;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable === true);
  };

  const onKeyDown = (e) => {
    if (e.code === 'Escape' || e.code === 'Tab' || typing(e)) return;
    const a = actionOf(e.code);
    if (a) {
      if (!keysDown.has(e.code)) {
        actionsPressed.add(a);
        stepPressed.add(a);
      }
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
      // Only a click on the game view engages (it must not also fire a shot).
      // Clicks on menus and their fields must not capture the mouse.
      if (e.target === canvas) lock();
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
  const onWheel = (e) => {
    if (locked && e.deltaY !== 0) wheel += Math.sign(e.deltaY);
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
  document.addEventListener('wheel', onWheel, { passive: true });

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
    // for fixedUpdate: pressed since the last frame that ran fixed steps
    stepPressed(name) {
      return stepPressed.has(name);
    },
    firePressed() {
      return buttons.firePressed;
    },
    adsPressed() {
      return buttons.adsPressed;
    },
    wheel() {
      return wheel;
    },
    consumeAim() {
      _aimOut.dx = aim.dx * aim.sensitivity;
      _aimOut.dy = aim.dy * aim.sensitivity;
      return _aimOut;
    },
    // after a frame that ran at least one fixed step
    endSteps() {
      stepPressed.clear();
    },
    // after every system has run this frame
    endFrame() {
      actionsPressed.clear();
      buttons.firePressed = false;
      buttons.adsPressed = false;
      aim.dx = 0;
      aim.dy = 0;
      wheel = 0;
    },
    dispose() {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('wheel', onWheel);
    },
  };
  return api;
}
