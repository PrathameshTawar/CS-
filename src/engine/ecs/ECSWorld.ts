/**
 * ECSWorld.ts
 * 
 * Entity Component System world implementation.
 * Provides a high-performance, type-safe ECS architecture for the engine.
 * 
 * @module ECS
 */

import { EventBus } from '../events/EventBus';

/**
 * Unique entity identifier
 */
export type EntityId = number;

/**
 * Base component interface - all components must extend this
 */
export interface IComponent {
  readonly type: string;
}

/**
 * System interface - systems process entities with specific component compositions
 */
export interface ISystem {
  readonly name: string;
  priority: number;
  init(world: ECSWorld): void;
  update(deltaTime: number): void;
  dispose(): void;
}

/**
 * Component storage using typed arrays for cache-friendly iteration
 */
class ComponentPool<T extends IComponent> {
  private readonly components: Map<EntityId, T> = new Map();
  private readonly sparse: Map<EntityId, number> = new Map();
  private readonly dense: EntityId[] = [];
  constructor(_type: string) { }


  get(entity: EntityId): T | undefined {
    return this.components.get(entity);
  }

  set(entity: EntityId, component: T): void {
    const exists = this.components.has(entity);
    this.components.set(entity, component);
    if (!exists) {
      this.sparse.set(entity, this.dense.length);
      this.dense.push(entity);
    }
  }

  remove(entity: EntityId): boolean {
    const removed = this.components.delete(entity);
    if (removed) {
      const index = this.sparse.get(entity);
      if (index !== undefined) {
        const last = this.dense.length - 1;
        if (index < last) {
          this.dense[index] = this.dense[last];
          this.sparse.set(this.dense[index], index);
        }
        this.dense.pop();
        this.sparse.delete(entity);
      }
    }
    return removed;
  }

  has(entity: EntityId): boolean {
    return this.components.has(entity);
  }

  getAll(): IterableIterator<[EntityId, T]> {
    return this.components.entries();
  }

  getEntities(): readonly EntityId[] {
    return this.dense;
  }

  getSize(): number {
    return this.components.size;
  }

  clear(): void {
    this.components.clear();
    this.sparse.clear();
    this.dense.length = 0;
  }
}

/**
 * Entity signature (bitmask of component types)
 */
type Signature = number;

/**
 * Manages entity IDs, component pools, and system orchestration
 */
export class ECSWorld {
  // Instance-level counter: avoids ID collisions when multiple worlds exist
  // (e.g., server simulation + client prediction running in the same process).
  private nextInstanceEntityId: EntityId = 1;

  private readonly entitySignatures: Map<EntityId, Signature> = new Map();
  private readonly componentPools: Map<string, ComponentPool<any>> = new Map();
  private readonly componentTypeIds: Map<string, number> = new Map();
  private readonly systems: ISystem[] = [];
  private readonly eventBus: EventBus;
  private nextComponentId: number = 0;
  private readonly freeEntityIds: EntityId[] = [];

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Creates a new entity and returns its ID
   */
  createEntity(): EntityId {
    const id = this.freeEntityIds.length > 0
      ? this.freeEntityIds.pop()!
      : this.nextInstanceEntityId++;

    this.entitySignatures.set(id, 0);
    this.eventBus.emit('ecs.entity.created', { entityId: id });
    return id;
  }

  /**
   * Destroys an entity and removes all its components
   */
  destroyEntity(entity: EntityId): void {
    if (!this.entitySignatures.has(entity)) {
      throw new Error(`Entity ${entity} does not exist.`);
    }

    // Remove all components from this entity
    for (const [, pool] of this.componentPools) {
      pool.remove(entity);
    }

    this.entitySignatures.delete(entity);
    this.freeEntityIds.push(entity);
    this.eventBus.emit('ecs.entity.destroyed', { entityId: entity });
  }

  /**
   * Checks if an entity exists
   */
  entityExists(entity: EntityId): boolean {
    return this.entitySignatures.has(entity);
  }

  /**
   * Registers a component type with the ECS world
   */
  registerComponent<T extends IComponent>(type: string): void {
    if (this.componentPools.has(type)) {
      return; // Already registered
    }

    const id = this.nextComponentId++;
    this.componentTypeIds.set(type, id);
    this.componentPools.set(type, new ComponentPool<T>(type));
  }

  /**
   * Gets the bit flag for a component type
   */
  private getComponentFlag(type: string): number {
    const id = this.componentTypeIds.get(type);
    if (id === undefined) {
      throw new Error(`Component type '${type}' is not registered.`);
    }
    return 1 << id;
  }

  /**
   * Adds a component to an entity
   */
  addComponent<T extends IComponent>(entity: EntityId, component: T): void {
    if (!this.entitySignatures.has(entity)) {
      throw new Error(`Entity ${entity} does not exist.`);
    }

    const pool = this.componentPools.get(component.type);
    if (!pool) {
      throw new Error(`Component type '${component.type}' is not registered.`);
    }

    pool.set(entity, component);

    // Update entity signature
    const flag = this.getComponentFlag(component.type);
    const signature = this.entitySignatures.get(entity)!;
    this.entitySignatures.set(entity, signature | flag);

    this.eventBus.emit('ecs.component.added', {
      entityId: entity,
      componentType: component.type,
    });
  }

  /**
   * Removes a component from an entity
   */
  removeComponent<_T extends IComponent>(entity: EntityId, componentType: string): void {
    if (!this.entitySignatures.has(entity)) {
      throw new Error(`Entity ${entity} does not exist.`);
    }

    const pool = this.componentPools.get(componentType);
    if (!pool) {
      throw new Error(`Component type '${componentType}' is not registered.`);
    }

    pool.remove(entity);

    // Update entity signature
    const flag = this.getComponentFlag(componentType);
    const signature = this.entitySignatures.get(entity)!;
    this.entitySignatures.set(entity, signature & ~flag);

    this.eventBus.emit('ecs.component.removed', {
      entityId: entity,
      componentType,
    });
  }

  /**
   * Gets a component from an entity
   */
  getComponent<T extends IComponent>(entity: EntityId, componentType: string): T | undefined {
    const pool = this.componentPools.get(componentType);
    if (!pool) return undefined;
    return pool.get(entity) as T | undefined;
  }

  /**
   * Checks if an entity has a specific component
   */
  hasComponent(entity: EntityId, componentType: string): boolean {
    const pool = this.componentPools.get(componentType);
    if (!pool) return false;
    return pool.has(entity);
  }

  /**
   * Queries all entities that have ALL of the specified component types
   */
  query(...componentTypes: string[]): EntityId[] {
    if (componentTypes.length === 0) return [];
    if (componentTypes.length > 31) {
      throw new Error('ECS supports at most 31 component types per query.');
    }

    // Build query signature mask
    let queryMask = 0;
    for (const type of componentTypes) {
      queryMask |= this.getComponentFlag(type);
    }

    // Find the smallest pool for iteration
    let smallestPool = this.componentPools.get(componentTypes[0]);
    for (let i = 1; i < componentTypes.length; i++) {
      const pool = this.componentPools.get(componentTypes[i]);
      if (pool && pool.getSize() < smallestPool!.getSize()) {
        smallestPool = pool;
      }
    }

    if (!smallestPool) return [];

    const results: EntityId[] = [];
    for (const entity of smallestPool.getEntities()) {
      const signature = this.entitySignatures.get(entity);
      if (signature !== undefined && (signature & queryMask) === queryMask) {
        results.push(entity);
      }
    }

    return results;
  }

  /**
   * Registers a system with the ECS world
   */
  registerSystem(system: ISystem): void {
    this.systems.push(system);
    this.systems.sort((a, b) => a.priority - b.priority);
    system.init(this);
    this.eventBus.emit('ecs.system.registered', { name: system.name });
  }

  /**
   * Unregisters a system from the ECS world
   */
  unregisterSystem(systemName: string): void {
    const index = this.systems.findIndex((s) => s.name === systemName);
    if (index !== -1) {
      const system = this.systems[index];
      system.dispose();
      this.systems.splice(index, 1);
      this.eventBus.emit('ecs.system.unregistered', { name: systemName });
    }
  }

  /**
   * Updates all registered systems
   */
  update(deltaTime: number): void {
    for (const system of this.systems) {
      system.update(deltaTime);
    }
  }

  /**
   * Returns the number of active entities
   */
  get entityCount(): number {
    return this.entitySignatures.size;
  }

  /**
   * Returns all registered component type names
   */
  get componentTypes(): string[] {
    return Array.from(this.componentPools.keys());
  }

  /**
   * Clears all entities and components
   */
  clear(): void {
    for (const [, pool] of this.componentPools) {
      pool.clear();
    }
    this.entitySignatures.clear();
    this.freeEntityIds.length = 0;
    this.nextInstanceEntityId = 1;
  }

  /**
   * Disposes the ECS world
   */
  dispose(): void {
    this.clear();
    this.componentPools.clear();
    this.systems.length = 0;
  }
}

