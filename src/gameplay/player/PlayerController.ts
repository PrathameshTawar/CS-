/**
 * PlayerController.ts
 *
 * First-person player controller with advanced movement:
 *  - Sprint / walk / crouch
 *  - Slide (sprint + crouch)
 *  - Wall-run and wall-jump
 *  - Vault (low obstacles) and mantle (chest-high ledges)
 *  - Ladder climbing
 *  - Jump with coyote time and jump buffering
 *  - ADS (aim down sights) affects FOV and weapon handling
 *
 * Physics is resolved against the PhysicsWorld AABB grid.
 *
 * @module Gameplay
 */

import * as THREE from 'three';
import { PhysicsWorld, AABB } from '../../physics/core/PhysicsWorld';
import { InputManager, Action } from '../core/InputManager';

export enum MoveState {
  Idle = 'idle',
  Walk = 'walk',
  Sprint = 'sprint',
  Crouch = 'crouch',
  Slide = 'slide',
  Air = 'air',
  WallRun = 'wallrun',
  Vault = 'vault',
  Mantle = 'mantle',
  Ladder = 'ladder',
  Dead = 'dead',
}

export interface PlayerState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  pitch: number;
  state: MoveState;
  grounded: boolean;
  crouching: boolean;
  sliding: boolean;
  wallRunning: boolean;
  wallNormal: THREE.Vector3;
  ads: boolean;
  sprinting: boolean;
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  dead: boolean;
  /** Current collision half-height (stands 1.8m, crouch 0.9m, slide 0.6m). */
  height: number;
}

export interface PlayerControllerConfig {
  walkSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  slideSpeed: number;
  airControl: number;
  jumpSpeed: number;
  gravity: number;
  maxFallSpeed: number;
  crouchHeight: number;
  standHeight: number;
  slideHeight: number;
  wallRunTime: number;
  wallRunGravityScale: number;
  wallJumpForce: number;
  coyoteTime: number;
  jumpBufferTime: number;
}

const DEFAULT_CONFIG: PlayerControllerConfig = {
  walkSpeed: 4.5,
  sprintSpeed: 7.0,
  crouchSpeed: 2.2,
  slideSpeed: 9.0,
  airControl: 0.35,
  jumpSpeed: 7.2,
  gravity: 22,
  maxFallSpeed: 30,
  crouchHeight: 0.9,
  standHeight: 1.8,
  slideHeight: 0.6,
  wallRunTime: 1.4,
  wallRunGravityScale: 0.25,
  wallJumpForce: 8.5,
  coyoteTime: 0.12,
  jumpBufferTime: 0.15,
};

const RADIUS = 0.35;

export class PlayerController {
  readonly state: PlayerState;
  private readonly config: PlayerControllerConfig;
  private readonly input: InputManager;
  private readonly physics: PhysicsWorld;

  // Timing
  private timeSinceGrounded = 0;
  private timeSinceJumpPressed = 0;
  private wallRunTimer = 0;
  private slideTimer = 0;
  private vaultTimer = 0;
  private mantleTimer = 0;
  private vaultTarget: THREE.Vector3 = new THREE.Vector3();
  private mantleTarget: THREE.Vector3 = new THREE.Vector3();

  private camera: THREE.PerspectiveCamera;
  private tempVec = new THREE.Vector3();

  constructor(
    camera: THREE.PerspectiveCamera,
    physics: PhysicsWorld,
    input: InputManager,
    config?: Partial<PlayerControllerConfig>,
    spawn?: { x: number; y: number; z: number; yaw: number }
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.camera = camera;
    this.physics = physics;
    this.input = input;

    this.state = {
      position: new THREE.Vector3(spawn?.x ?? 0, spawn?.y ?? 2, spawn?.z ?? 0),
      velocity: new THREE.Vector3(),
      yaw: spawn?.yaw ?? 0,
      pitch: 0,
      state: MoveState.Idle,
      grounded: false,
      crouching: false,
      sliding: false,
      wallRunning: false,
      wallNormal: new THREE.Vector3(),
      ads: false,
      sprinting: false,
      health: 100,
      maxHealth: 100,
      armor: 50,
      maxArmor: 50,
      dead: false,
      height: this.config.standHeight,
    };
  }

  getPosition(): THREE.Vector3 {
    return this.state.position.clone();
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  /** Eye position = position + eye height offset (kept inside the capsule). */
  getEyePosition(): THREE.Vector3 {
    return new THREE.Vector3(
      this.state.position.x,
      this.state.position.y + this.state.height * 0.45,
      this.state.position.z
    );
  }

  /** Forward direction of the camera (ignoring pitch). */
  getForward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.state.yaw), 0, -Math.cos(this.state.yaw));
  }

  applyDamage(amount: number): void {
    if (this.state.dead) return;
    // Armor absorbs 50%
    const armorAbsorb = Math.min(this.state.armor, amount * 0.5);
    this.state.armor -= armorAbsorb;
    const healthLoss = amount - armorAbsorb;
    this.state.health = Math.max(0, this.state.health - healthLoss);
    if (this.state.health <= 0) {
      this.state.dead = true;
      this.state.state = MoveState.Dead;
    }
  }

  heal(amount: number): void {
    this.state.health = Math.min(this.state.maxHealth, this.state.health + amount);
  }

  setSpawn(x: number, y: number, z: number, yaw: number): void {
    this.state.position.set(x, y, z);
    this.state.yaw = yaw;
    this.state.velocity.set(0, 0, 0);
    this.state.health = this.state.maxHealth;
    this.state.armor = this.state.maxArmor;
    this.state.dead = false;
    this.state.state = MoveState.Idle;
  }

  /**
   * Per-frame update. Applies look input, movement input, physics,
   * and syncs the camera.
   */
  update(deltaTime: number): void {
    // --- Look ---
    const look = this.input.getLookDelta(this.state.ads);
    this.state.yaw -= look.x;
    this.state.pitch -= look.y;
    this.state.pitch = THREE.MathUtils.clamp(this.state.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);

    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.state.yaw;
    this.camera.rotation.x = this.state.pitch;
    this.camera.rotation.z = 0;

    if (this.state.dead) {
      this.camera.position.copy(this.getEyePosition());
      return;
    }

    // --- ADS ---
    const aimHeld = this.input.isDown(Action.Aim);
    const canAim = this.state.state !== MoveState.Slide && this.state.state !== MoveState.Vault && this.state.state !== MoveState.Mantle;
    this.state.ads = aimHeld && canAim;

    // --- Timing accumulators ---
    this.timeSinceGrounded += deltaTime;
    if (this.input.wasPressed(Action.Jump)) this.timeSinceJumpPressed = 0;
    else this.timeSinceJumpPressed += deltaTime;

    const isSprintHeld = this.input.isDown(Action.Sprint);
    const isCrouchHeld = this.input.isDown(Action.Crouch);
    const forwardInput = (this.input.isDown(Action.Forward) ? 1 : 0) - (this.input.isDown(Action.Backward) ? 1 : 0);
    const rightInput = (this.input.isDown(Action.Right) ? 1 : 0) - (this.input.isDown(Action.Left) ? 1 : 0);

    // --- Special states (vault/mantle) ---
    if (this.state.state === MoveState.Vault) {
      this.updateVault(deltaTime);
      return;
    }
    if (this.state.state === MoveState.Mantle) {
      this.updateMantle(deltaTime);
      return;
    }

    // --- Ladder ---
    if (this.state.state === MoveState.Ladder) {
      this.updateLadder(deltaTime, forwardInput);
      return;
    }

    const wasGrounded = this.state.grounded;
    const moving = Math.abs(forwardInput) + Math.abs(rightInput) > 0;

    // --- Sprint ---
    const sprinting = isSprintHeld && forwardInput > 0 && !isCrouchHeld &&
      this.state.grounded && this.state.state !== MoveState.Slide;
    this.state.sprinting = sprinting;

    // --- Slide input (sprint + crouch while grounded & moving) ---
    const slidePressed = isCrouchHeld && this.state.sprinting && moving && this.state.grounded &&
      this.state.state !== MoveState.Slide;

    if (slidePressed) {
      this.state.state = MoveState.Slide;
      this.state.sliding = true;
      this.state.crouching = true;
      this.state.height = this.config.slideHeight;
      this.slideTimer = 0;
      // Forward impulse
      const fwd = this.getForward();
      const speed = Math.max(this.config.slideSpeed, this.state.velocity.length());
      this.state.velocity.x = fwd.x * speed;
      this.state.velocity.z = fwd.z * speed;
    }

    if (this.state.state === MoveState.Slide) {
      this.updateSlide(deltaTime, forwardInput, rightInput);
    } else {
      // --- Normal movement ---
      if (this.state.grounded) {
        this.state.height = isCrouchHeld ? this.config.crouchHeight : this.config.standHeight;
        this.state.crouching = isCrouchHeld;
        const speed = isCrouchHeld ? this.config.crouchSpeed : sprinting ? this.config.sprintSpeed : this.config.walkSpeed;

        const moveDir = this.getMoveDirection(forwardInput, rightInput);
        const targetVel = moveDir.multiplyScalar(speed);
        const lerp = Math.min(1, deltaTime * (this.state.grounded ? 12 : 4));
        this.state.velocity.x = THREE.MathUtils.lerp(this.state.velocity.x, targetVel.x, lerp);
        this.state.velocity.z = THREE.MathUtils.lerp(this.state.velocity.z, targetVel.z, lerp);
      } else {
        // Air control
        const moveDir = this.getMoveDirection(forwardInput, rightInput);
        const accel = moveDir.multiplyScalar(this.config.airControl * this.config.walkSpeed * deltaTime);
        this.state.velocity.x += accel.x;
        this.state.velocity.z += accel.z;
      }

      // --- Jump (with coyote time + buffer) ---
      const canJump = (this.state.grounded || this.timeSinceGrounded < this.config.coyoteTime);
      if (this.timeSinceJumpPressed < this.config.jumpBufferTime && canJump) {
        this.state.velocity.y = this.config.jumpSpeed;
        this.state.grounded = false;
        this.timeSinceGrounded = this.config.coyoteTime + 1; // consume coyote
        this.timeSinceJumpPressed = this.config.jumpBufferTime + 1; // consume buffer
      }

      // --- Wall run detection (airborne, moving toward wall) ---
      this.updateWallRun(deltaTime, forwardInput);
    }

    // --- Gravity ---
    const gravityScale = this.state.wallRunning ? this.config.wallRunGravityScale : 1;
    if (!this.state.grounded) {
      this.state.velocity.y -= this.config.gravity * gravityScale * deltaTime;
      this.state.velocity.y = Math.max(this.state.velocity.y, -this.config.maxFallSpeed);
    }

    // --- Integrate position with collision ---
    this.integrate(deltaTime);

    // --- Ground detection (done inside integrate via resolveCollision) ---
    if (this.state.grounded && !wasGrounded) {
      this.state.state = MoveState.Idle;
    }
    if (this.state.grounded) {
      this.timeSinceGrounded = 0;
    }

    // --- State classification for animation/audio ---
    if (this.state.grounded) {
      if (this.state.sliding) this.state.state = MoveState.Slide;
      else if (sprinting && moving) this.state.state = MoveState.Sprint;
      else if (moving) this.state.state = MoveState.Walk;
      else this.state.state = isCrouchHeld ? MoveState.Crouch : MoveState.Idle;
    } else if (this.state.wallRunning) {
      this.state.state = MoveState.WallRun;
    } else {
      this.state.state = MoveState.Air;
    }

    this.syncCamera();
  }

  private getMoveDirection(forwardInput: number, rightInput: number): THREE.Vector3 {
    const fwd = this.getForward();
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const dir = new THREE.Vector3()
      .addScaledVector(fwd, forwardInput)
      .addScaledVector(right, rightInput);
    if (dir.lengthSq() > 0) dir.normalize();
    return dir;
  }

  private updateSlide(deltaTime: number, forwardInput: number, rightInput: number): void {
    this.slideTimer += deltaTime;
    // Friction decays slide speed
    const friction = 1 - Math.min(1, deltaTime * 2.2);
    this.state.velocity.x *= friction;
    this.state.velocity.z *= friction;

    // Allow slight steering
    const steer = this.getMoveDirection(forwardInput, rightInput);
    const steerFactor = Math.min(1, this.slideTimer * 0.5);
    this.state.velocity.x += steer.x * 2 * steerFactor * deltaTime;
    this.state.velocity.z += steer.z * 2 * steerFactor * deltaTime;

    // End slide when too slow or jump
    if (this.state.velocity.length() < 3.2) {
      this.state.state = MoveState.Idle;
      this.state.sliding = false;
      this.state.crouching = false;
      this.state.height = this.config.standHeight;
    }
  }

  private updateWallRun(deltaTime: number, forwardInput: number): void {
    const isAirborne = !this.state.grounded;
    const moving = Math.abs(forwardInput) > 0;

    if (!isAirborne || this.state.sliding || this.state.state === MoveState.Vault || this.state.state === MoveState.Mantle) {
      this.state.wallRunning = false;
      this.wallRunTimer = 0;
      return;
    }

    if (!this.state.wallRunning) {
      // Try to detect a wall
      const wall = this.detectWall();
      if (wall && this.state.velocity.y < 0 && moving) {
        this.state.wallRunning = true;
        this.state.wallNormal.copy(wall);
        this.wallRunTimer = 0;
      }
    } else {
      this.wallRunTimer += deltaTime;
      // Friction along the wall
      const tangent = new THREE.Vector3(this.state.wallNormal.z, 0, -this.state.wallNormal.x);
      const speedAlong = this.state.velocity.dot(tangent);
      const desired = Math.max(speedAlong, this.config.walkSpeed);
      this.state.velocity.x += tangent.x * (desired - speedAlong) * Math.min(1, deltaTime * 6);
      this.state.velocity.z += tangent.z * (desired - speedAlong) * Math.min(1, deltaTime * 6);

      // Wall jump
      if (this.input.wasPressed(Action.Jump)) {
        const wallJumpDir = this.state.wallNormal.clone().add(new THREE.Vector3(0, 1, 0)).normalize();
        this.state.velocity.x = wallJumpDir.x * this.config.wallJumpForce;
        this.state.velocity.z = wallJumpDir.z * this.config.wallJumpForce;
        this.state.velocity.y = this.config.jumpSpeed * 0.9;
        this.state.wallRunning = false;
        this.wallRunTimer = 0;
        this.timeSinceJumpPressed = this.config.jumpBufferTime + 1;
      }

      // Time out or leave the wall
      const wall = this.detectWall();
      if (!wall || this.wallRunTimer > this.config.wallRunTime) {
        this.state.wallRunning = false;
        this.wallRunTimer = 0;
      }
    }
  }

  private detectWall(): THREE.Vector3 | null {
    const eye = this.getEyePosition();
    const checks = [
      this.physics.raycast(eye, { x: 1, y: 0, z: 0 }, 1.2),
      this.physics.raycast(eye, { x: -1, y: 0, z: 0 }, 1.2),
      this.physics.raycast(eye, { x: 0, y: 0, z: 1 }, 1.2),
      this.physics.raycast(eye, { x: 0, y: 0, z: -1 }, 1.2),
    ];
    let closest: { dist: number; normal: THREE.Vector3 } | null = null;
    for (const hit of checks) {
      if (hit) {
        const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
        if (n.y === 0 && (!closest || hit.distance < closest.dist)) {
          closest = { dist: hit.distance, normal: n };
        }
      }
    }
    return closest ? closest.normal : null;
  }

  /**
   * Attempt a vault over a low obstacle in front of the player.
   * Returns true if the vault started.
   */
  tryVault(): boolean {
    if (!this.state.grounded || this.state.state === MoveState.Vault || this.state.state === MoveState.Mantle) return false;

    const eye = this.getEyePosition();
    const fwd = this.getForward();
    const hit = this.physics.raycast(
      eye,
      { x: fwd.x, y: 0, z: fwd.z },
      2.2
    );

    if (hit && hit.block && hit.block.hy <= 1.0 && hit.distance < 1.8) {
      // Obstacle low enough to vault; find landing point past it
      const past = new THREE.Vector3(
        this.state.position.x + fwd.x * 3.0,
        this.state.position.y,
        this.state.position.z + fwd.z * 3.0
      );
      const clearance = this.physics.pointBlocked(past.x, this.state.position.y + 0.8, past.z);
      if (!clearance) {
        this.vaultTarget.copy(past);
        this.state.state = MoveState.Vault;
        this.state.velocity.set(0, 0, 0);
        this.vaultTimer = 0;
        return true;
      }
    }
    return false;
  }

  private updateVault(deltaTime: number): void {
    this.vaultTimer += deltaTime;
    const t = Math.min(1, this.vaultTimer / 0.45);
    this.state.position.lerp(this.vaultTarget, Math.min(1, t * 1.2));
    this.state.position.y = this.vaultTarget.y + Math.sin(t * Math.PI) * 0.6;
    this.syncCamera();
    if (t >= 1) {
      this.state.state = MoveState.Idle;
    }
  }

  /**
   * Attempt a mantle onto a chest-high ledge. Returns true if started.
   */
  tryMantle(): boolean {
    if (!this.state.grounded || this.state.state === MoveState.Mantle || this.state.state === MoveState.Vault) return false;

    const eye = this.getEyePosition();
    const fwd = this.getForward();
    const hit = this.physics.raycast(
      eye,
      { x: fwd.x, y: 0, z: fwd.z },
      1.6
    );

    if (hit && hit.block && hit.block.hy > 1.0 && hit.block.hy <= 1.6 && hit.distance < 1.2) {
      const top = hit.block.y + hit.block.hy;
      const past = new THREE.Vector3(
        this.state.position.x + fwd.x * 1.2,
        top + 0.1,
        this.state.position.z + fwd.z * 1.2
      );
      this.mantleTarget.copy(past);
      this.state.state = MoveState.Mantle;
      this.state.velocity.set(0, 0, 0);
      this.mantleTimer = 0;
      return true;
    }
    return false;
  }

  private updateMantle(deltaTime: number): void {
    this.mantleTimer += deltaTime;
    const t = Math.min(1, this.mantleTimer / 0.55);
    this.state.position.lerp(this.mantleTarget, Math.min(1, t * 1.1));
    this.syncCamera();
    if (t >= 1) {
      this.state.state = MoveState.Idle;
    }
  }

  private updateLadder(deltaTime: number, forwardInput: number): void {
    this.state.velocity.x *= 0.8;
    this.state.velocity.z *= 0.8;
    const up = this.input.isDown(Action.Forward) ? 1 : this.input.isDown(Action.Backward) ? -1 : 0;
    this.state.velocity.y = up * 4;
    this.state.position.y += this.state.velocity.y * deltaTime;
    if (this.input.wasPressed(Action.Jump)) {
      this.state.velocity.y = this.config.jumpSpeed;
      this.state.state = MoveState.Air;
    }
    // Climb off ladder top
    const eye = this.getEyePosition();
    const fwd = this.getForward();
    void forwardInput;
    const hit = this.physics.raycast(eye, { x: fwd.x, y: 0, z: fwd.z }, 0.8);
    if (!hit) {
      this.state.state = MoveState.Air;
    }
    this.syncCamera();
  }

  /** Enter ladder mode when near a ladder volume. */
  enterLadder(): boolean {
    const eye = this.getEyePosition();
    const fwd = this.getForward();
    const hit = this.physics.raycast(eye, { x: fwd.x, y: 0, z: fwd.z }, 1.2);
    if (hit && hit.block && hit.block.material === 'metal' && hit.block.hy > 1.5) {
      this.state.state = MoveState.Ladder;
      this.state.velocity.set(0, 0, 0);
      return true;
    }
    return false;
  }

  private integrate(deltaTime: number): void {
    const prevX = this.state.position.x;
    const prevZ = this.state.position.z;

    this.state.position.x += this.state.velocity.x * deltaTime;
    this.state.position.z += this.state.velocity.z * deltaTime;
    this.state.position.y += this.state.velocity.y * deltaTime;

    const box = this.getAABB();
    const result = this.physics.resolveCollision(box);

    // Rebuild position from resolved box
    this.state.position.x = (box.minX + box.maxX) / 2;
    this.state.position.y = (box.minY + box.maxY) / 2 - 0.01;
    this.state.position.z = (box.minZ + box.maxZ) / 2;

    if (result.grounded) {
      this.state.grounded = true;
      if (this.state.velocity.y < 0) this.state.velocity.y = 0;
    } else {
      this.state.grounded = false;
    }

    if (result.hitWall && this.state.wallRunning) {
      // keep wall run alive
    }

    void prevX;
    void prevZ;
  }

  private getAABB(): AABB {
    const h = this.state.height / 2;
    return {
      minX: this.state.position.x - RADIUS,
      maxX: this.state.position.x + RADIUS,
      minY: this.state.position.y - h,
      maxY: this.state.position.y + h,
      minZ: this.state.position.z - RADIUS,
      maxZ: this.state.position.z + RADIUS,
    };
  }

  private syncCamera(): void {
    const eyeY = this.state.position.y + this.state.height * 0.45;
    this.camera.position.set(this.state.position.x, eyeY, this.state.position.z);
    this.tempVec.copy(this.camera.position);
  }

  /** Whether the player is on the ground (for footstep audio). */
  isGrounded(): boolean {
    return this.state.grounded;
  }

  /** Current horizontal speed (for audio/anim). */
  getHorizontalSpeed(): number {
    return Math.hypot(this.state.velocity.x, this.state.velocity.z);
  }

  getMoveState(): MoveState {
    return this.state.state;
  }
}
