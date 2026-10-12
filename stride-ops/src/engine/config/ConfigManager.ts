/**
 * ConfigManager.ts
 * 
 * Centralized configuration management with schema validation,
 * change detection, and reactive updates.
 * 
 * @module Config
 */

/**
 * Config value type map
 */
export interface ConfigSchema {
  [key: string]: ConfigValueType;
}

type ConfigValueType = 'string' | 'number' | 'boolean' | 'object' | 'array';

/**
 * Configuration change event
 */
export interface ConfigChangeEvent {
  key: string;
  oldValue: any;
  newValue: any;
}

/**
 * Configuration validation rule
 */
export interface ConfigRule {
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: any[];
  validate?: (value: any) => boolean;
}

/**
 * Configuration manager with schema validation
 */
export class ConfigManager {
  private readonly config: Map<string, any> = new Map();
  private readonly defaults: Map<string, any> = new Map();
  private readonly rules: Map<string, ConfigRule> = new Map();
  private readonly listeners: Map<string, Set<(event: ConfigChangeEvent) => void>> = new Map();
  private readonly schema: Map<string, ConfigValueType> = new Map();
  private frozen: boolean = false;

  constructor(defaultConfig?: Record<string, any>) {
    if (defaultConfig) {
      for (const [key, value] of Object.entries(defaultConfig)) {
        this.defaults.set(key, value);
        this.config.set(key, value);
        this.schema.set(key, this.inferType(value));
      }
    }
  }

  /**
   * Infer the config value type from a value
   */
  private inferType(value: any): ConfigValueType {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'object';
    return typeof value as ConfigValueType;
  }

  /**
   * Define a configuration key with schema and validation rules
   */
  define(
    key: string,
    defaultValue: any,
    type?: ConfigValueType,
    rules?: ConfigRule
  ): void {
    if (this.frozen) {
      throw new Error('Cannot define config on a frozen ConfigManager.');
    }

    this.defaults.set(key, defaultValue);
    this.config.set(key, defaultValue);
    this.schema.set(key, type ?? this.inferType(defaultValue));

    if (rules) {
      this.rules.set(key, rules);
    }
  }

  /**
   * Get a configuration value by key
   */
  get<T = any>(key: string, defaultValue?: T): T {
    if (this.config.has(key)) {
      return this.config.get(key) as T;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    if (this.defaults.has(key)) {
      return this.defaults.get(key) as T;
    }
    throw new Error(`Configuration key '${key}' not found.`);
  }

  /**
   * Set a configuration value by key
   */
  set<T = any>(key: string, value: T): void {
    if (this.frozen) {
      throw new Error('Cannot modify frozen configuration.');
    }

    // Validate type if schema exists
    const expectedType = this.schema.get(key);
    if (expectedType) {
      const actualType = this.inferType(value);
      if (actualType !== expectedType) {
        throw new Error(
          `Configuration '${key}' expected type '${expectedType}', got '${actualType}'.`
        );
      }
    }

    // Validate rules
    const rule = this.rules.get(key);
    if (rule) {
      this.validateValue(key, value, rule);
    }

    const oldValue = this.config.get(key);
    this.config.set(key, value);

    // Notify listeners
    if (oldValue !== value) {
      this.notifyListeners(key, { key, oldValue, newValue: value });
    }
  }

  /**
   * Validate a value against rules
   */
  private validateValue(key: string, value: any, rule: ConfigRule): void {
    if (rule.required && (value === undefined || value === null)) {
      throw new Error(`Configuration '${key}' is required.`);
    }

    if (typeof value === 'number') {
      if (rule.min !== undefined && value < rule.min) {
        throw new Error(`Configuration '${key}' must be >= ${rule.min}.`);
      }
      if (rule.max !== undefined && value > rule.max) {
        throw new Error(`Configuration '${key}' must be <= ${rule.max}.`);
      }
    }

    if (typeof value === 'string') {
      if (rule.pattern && !rule.pattern.test(value)) {
        throw new Error(`Configuration '${key}' does not match required pattern.`);
      }
    }

    if (rule.enum && !rule.enum.includes(value)) {
      throw new Error(
        `Configuration '${key}' must be one of: ${rule.enum.join(', ')}`
      );
    }

    if (rule.validate && !rule.validate(value)) {
      throw new Error(`Configuration '${key}' failed custom validation.`);
    }
  }

  /**
   * Check if a configuration key exists
   */
  has(key: string): boolean {
    return this.config.has(key);
  }

  /**
   * Get all configuration keys
   */
  get keys(): string[] {
    return Array.from(this.config.keys());
  }

  /**
   * Get all configuration as a plain object
   */
  getAll(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of this.config) {
      result[key] = value;
    }
    return result;
  }

  /**
   * Reset a configuration value to its default
   */
  reset(key: string): void {
    if (this.defaults.has(key)) {
      this.set(key, this.defaults.get(key));
    }
  }

  /**
   * Reset all configuration values to defaults
   */
  resetAll(): void {
    for (const [key, value] of this.defaults) {
      this.config.set(key, value);
    }
  }

  /**
   * Subscribe to changes on a specific key
   */
  onChange(key: string, callback: (event: ConfigChangeEvent) => void): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(callback);
    return () => this.listeners.get(key)?.delete(callback);
  }

  /**
   * Subscribe to all configuration changes
   */
  onAnyChange(callback: (event: ConfigChangeEvent) => void): () => void {
    const disposers: (() => void)[] = [];
    for (const key of this.config.keys()) {
      disposers.push(this.onChange(key, callback));
    }
    return () => disposers.forEach((d) => d());
  }

  /**
   * Notify listeners of a configuration change
   */
  private notifyListeners(key: string, event: ConfigChangeEvent): void {
    const listeners = this.listeners.get(key);
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(event);
        } catch (error) {
          console.error(
            `[ConfigManager] Error in listener for '${key}':`,
            error
          );
        }
      }
    }
  }

  /**
   * Freeze the configuration to prevent further changes
   */
  freeze(): void {
    this.frozen = true;
  }

  /**
   * Serialize configuration to JSON
   */
  toJSON(): string {
    return JSON.stringify(this.getAll(), null, 2);
  }

  /**
   * Load configuration from a JSON string
   */
  fromJSON(json: string): void {
    const data = JSON.parse(json);
    for (const [key, value] of Object.entries(data)) {
      if (this.config.has(key)) {
        this.set(key, value);
      }
    }
  }

  /**
   * Dispose the configuration manager
   */
  dispose(): void {
    this.config.clear();
    this.defaults.clear();
    this.rules.clear();
    this.listeners.clear();
    this.schema.clear();
  }
}
