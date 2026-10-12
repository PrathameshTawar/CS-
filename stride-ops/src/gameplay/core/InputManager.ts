/**
 * InputManager.ts
 *
 * Unified input manager: keyboard, mouse (with pointer lock / raw delta),
 * and gamepad. Supports full key remapping persisted to localStorage,
 * sensitivity curves, and dead-zone calibration.
 *
 * @module Gameplay
 */

export enum Action {
  Forward = 'forward',
  Backward = 'backward',
  Left = 'left',
  Right = 'right',
  Jump = 'jump',
  Crouch = 'crouch',
  Sprint = 'sprint',
  Slide = 'slide',
  Interact = 'interact',
  Fire = 'fire',
  Aim = 'aim',
  Reload = 'reload',
  Inspect = 'inspect',
  Switch1 = 'switch1',
  Switch2 = 'switch2',
  Switch3 = 'switch3',
  Switch4 = 'switch4',
  Switch5 = 'switch5',
  Switch6 = 'switch6',
  Dash = 'dash',
  GrenadeSmoke = 'grenade_smoke',
  GrenadeFlash = 'grenade_flash',
  GrenadeShock = 'grenade_shock',
  Ping = 'ping',
  NextWeapon = 'next_weapon',
  PrevWeapon = 'prev_weapon',
}

export interface InputConfig {
  sensitivity: number;
  adsSensitivityMultiplier: number;
  invertY: boolean;
  gamepadDeadzone: number;
}

export interface GamepadAxes {
  leftStick: { x: number; y: number };
  rightStick: { x: number; y: number };
}

const DEFAULT_BINDINGS: Record<Action, string> = {
  [Action.Forward]: 'KeyW',
  [Action.Backward]: 'KeyS',
  [Action.Left]: 'KeyA',
  [Action.Right]: 'KeyD',
  [Action.Jump]: 'Space',
  [Action.Crouch]: 'ControlLeft',
  [Action.Sprint]: 'ShiftLeft',
  [Action.Slide]: 'ShiftLeft',
  [Action.Interact]: 'KeyE',
  [Action.Fire]: 'Mouse0',
  [Action.Aim]: 'Mouse2',
  [Action.Reload]: 'KeyR',
  [Action.Inspect]: 'KeyJ',
  [Action.Switch1]: 'Digit1',
  [Action.Switch2]: 'Digit2',
  [Action.Switch3]: 'Digit3',
  [Action.Switch4]: 'Digit4',
  [Action.Switch5]: 'Digit5',
  [Action.Switch6]: 'Digit6',
  [Action.Dash]: 'ShiftLeft',
  [Action.GrenadeSmoke]: 'KeyG',
  [Action.GrenadeFlash]: 'KeyF',
  [Action.GrenadeShock]: 'KeyV',
  [Action.Ping]: 'KeyZ',
  [Action.NextWeapon]: 'WheelDown',
  [Action.PrevWeapon]: 'WheelUp',
};

const STORAGE_KEY = 'fps_input_bindings';

export class InputManager {
  private bindings: Record<Action, string>;
  private pressed = new Set<string>();
  private justPressed = new Set<string>();
  private justReleased = new Set<string>();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private config: InputConfig;
  private activeGamepad: Gamepad | null = null;
  private gamepadButtonsPrev: boolean[] = [];
  private element: HTMLElement | null = null;
  private pointerLocked = false;

  constructor(config?: Partial<InputConfig>) {
    this.config = {
      sensitivity: 1.0,
      adsSensitivityMultiplier: 0.6,
      invertY: false,
      gamepadDeadzone: 0.15,
      ...config,
    };
    this.bindings = this.loadBindings();
  }

  private loadBindings(): Record<Action, string> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Record<Action, string>>;
        return { ...DEFAULT_BINDINGS, ...saved };
      }
    } catch {
      // ignore corrupted storage
    }
    return { ...DEFAULT_BINDINGS };
  }

  /**
   * Attach to an element and begin listening. Optionally requests pointer lock.
   */
  attach(element: HTMLElement, requestPointerLock = true): void {
    this.element = element;

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    element.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    element.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('wheel', this.onWheel, { passive: false });

    document.addEventListener('pointerlockchange', this.onPointerLockChange);

    if (requestPointerLock) {
      this.requestPointerLock();
    }
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.element?.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.element?.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.element = null;
    // If we detach while locked, clear the stale flag so a later attach()
    // always re-requests pointer lock instead of silently skipping it.
    this.pointerLocked = false;
  }

  requestPointerLock(): void {
    if (this.element && !this.pointerLocked) {
      this.requestLock(this.element);
    }
  }

  /**
   * requestPointerLock() returns a Promise in modern browsers and rejects when
   * the request is denied or superseded (e.g. re-attach after a menu return).
   * Swallow the rejection so it never surfaces as an unhandled rejection.
   */
  private requestLock(target: HTMLElement): void {
    try {
      const ret = target.requestPointerLock() as unknown as
        { catch?: (r: unknown) => unknown } | undefined;
      ret?.catch?.(() => { /* denied or superseded — non-fatal */ });
    } catch {
      /* pointer lock unsupported */
    }
  }

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.element;
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.pressed.has(e.code)) {
      this.justPressed.add(e.code);
    }
    this.pressed.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.pressed.delete(e.code);
    this.justReleased.add(e.code);
  };

  private onMouseDown = (e: MouseEvent): void => {
    const code = `Mouse${e.button}`;
    if (!this.pressed.has(code)) {
      this.justPressed.add(code);
    }
    this.pressed.add(code);
  };

  private onMouseUp = (e: MouseEvent): void => {
    const code = `Mouse${e.button}`;
    this.pressed.delete(code);
    this.justReleased.add(code);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.pointerLocked) {
      this.mouseDeltaX += e.movementX;
      this.mouseDeltaY += e.movementY;
    }
  };

  private onWheel = (e: WheelEvent): void => {
    if (e.deltaY > 0) {
      this.justPressed.add(this.bindings[Action.NextWeapon]);
    } else if (e.deltaY < 0) {
      this.justPressed.add(this.bindings[Action.PrevWeapon]);
    }
  };

  /** Action is held down. */
  isDown(action: Action): boolean {
    return this.pressed.has(this.bindings[action]);
  }

  /** Action was pressed this frame. */
  wasPressed(action: Action): boolean {
    return this.justPressed.has(this.bindings[action]);
  }

  /** Action was released this frame. */
  wasReleased(action: Action): boolean {
    return this.justReleased.has(this.bindings[action]);
  }

  /**
   * Consume accumulated mouse deltas (raw, unscaled by sensitivity).
   */
  consumeMouseDelta(): { x: number; y: number } {
    const d = { x: this.mouseDeltaX, y: this.mouseDeltaY };
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return d;
  }

  /**
   * Get look deltas already scaled by sensitivity (and inverted when needed).
   */
  getLookDelta(ads: boolean): { x: number; y: number } {
    const raw = this.consumeMouseDelta();
    const sens = this.config.sensitivity * (ads ? this.config.adsSensitivityMultiplier : 1);
    return {
      x: raw.x * sens * 0.002,
      y: raw.y * sens * 0.002 * (this.config.invertY ? 1 : -1),
    };
  }

  /** Read gamepad axes with dead-zone applied. */
  getGamepadAxes(): GamepadAxes | null {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    const pad = pads.find((p) => p !== null && p.connected) ?? null;
    this.activeGamepad = pad;
    if (!pad) return null;

    const dz = this.config.gamepadDeadzone;
    const deadzone = (v: number): number => {
      const mag = Math.abs(v);
      if (mag < dz) return 0;
      return (mag - dz) / (1 - dz) * (v < 0 ? -1 : 1);
    };

    return {
      leftStick: { x: deadzone(pad.axes[0] ?? 0), y: deadzone(pad.axes[1] ?? 0) },
      rightStick: { x: deadzone(pad.axes[2] ?? 0), y: deadzone(pad.axes[3] ?? 0) },
    };
  }

  /** Gamepad button pressed this frame (index = standard mapping). */
  gamepadButtonPressed(index: number): boolean {
    if (!this.activeGamepad) return false;
    const pressed = this.activeGamepad.buttons[index]?.pressed ?? false;
    const was = this.gamepadButtonsPrev[index] ?? false;
    return pressed && !was;
  }

  /**
   * Remap an action to a new key code and persist.
   */
  remap(action: Action, code: string): void {
    this.bindings[action] = code;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch {
      // storage unavailable
    }
  }

  getBinding(action: Action): string {
    return this.bindings[action];
  }

  getConfig(): Readonly<InputConfig> {
    return { ...this.config };
  }

  setSensitivity(sensitivity: number): void {
    this.config.sensitivity = sensitivity;
  }

  /** Whether the pointer is currently locked (game focused). */
  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  /** End of frame bookkeeping. */
  endFrame(): void {
    this.justPressed.clear();
    this.justReleased.clear();
    this.updateGamepadPrev();
  }

  private updateGamepadPrev(): void {
    if (this.activeGamepad) {
      this.gamepadButtonsPrev = this.activeGamepad.buttons.map((b) => b.pressed);
    }
  }

  dispose(): void {
    this.detach();
  }
}
