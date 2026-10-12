/**
 * Serializer.ts
 * 
 * Serialization utilities for engine state, entities, and assets.
 * Supports binary and JSON serialization with versioning.
 * 
 * @module Serialization
 */

/**
 * Serializable interface - implement for serializable objects
 */
export interface ISerializable {
  serialize(): SerializedData;
  deserialize(data: SerializedData): void;
}

/**
 * Serialized data structure
 */
export interface SerializedData {
  version: number;
  type: string;
  data: any;
  metadata?: Record<string, any>;
}

/**
 * Binary serialization format header
 */
interface BinaryHeader {
  magic: number; // Magic number for format identification
  version: number;
  type: string;
  dataSize: number;
  checksum: number;
}

/**
 * Serializer class with format versioning
 */
export class Serializer {
  private static readonly CURRENT_VERSION = 1;
  private static readonly MAGIC_NUMBER = 0x465053; // "FPS" in ASCII
  private static readonly registry: Map<string, new () => ISerializable> = new Map();

  /**
   * Register a serializable type
   */
  static register(type: string, ctor: new () => ISerializable): void {
    if (this.registry.has(type)) {
      console.warn(`[Serializer] Type '${type}' is already registered. Overwriting.`);
    }
    this.registry.set(type, ctor);
  }

  /**
   * Serialize a value to JSON
   */
  static toJSON(value: any): string {
    return JSON.stringify(value, (_key, val) => {
      if (val instanceof Float32Array || val instanceof Float64Array) {
        return { __type: 'FloatArray', data: Array.from(val) };
      }
      if (val instanceof Int32Array || val instanceof Uint32Array) {
        return { __type: 'IntArray', data: Array.from(val) };
      }
      if (val instanceof Map) {
        return { __type: 'Map', data: Array.from(val.entries()) };
      }
      if (val instanceof Set) {
        return { __type: 'Set', data: Array.from(val) };
      }
      if (val && typeof val === 'object' && 'serialize' in val) {
        return (val as ISerializable).serialize();
      }
      return val;
    });
  }

  /**
   * Deserialize from JSON string
   */
  static fromJSON<T = any>(json: string): T {
    return JSON.parse(json, (_key, val) => {
      if (val && typeof val === 'object') {
        if (val.__type === 'FloatArray') return new Float32Array(val.data);
        if (val.__type === 'IntArray') return new Int32Array(val.data);
        if (val.__type === 'Map') return new Map(val.data);
        if (val.__type === 'Set') return new Set(val.data);
      }
      return val;
    }) as T;
  }

  /**
   * Serialize to binary format
   */
  static toBinary(data: any): ArrayBuffer {
    const json = JSON.stringify(data);
    const encoder = new TextEncoder();
    const jsonBytes = encoder.encode(json);

    const header: BinaryHeader = {
      magic: this.MAGIC_NUMBER,
      version: this.CURRENT_VERSION,
      type: typeof data,
      dataSize: jsonBytes.byteLength,
      checksum: this.computeChecksum(jsonBytes),
    };

    const headerBuffer = new ArrayBuffer(20); // 5 × uint32
    const headerView = new DataView(headerBuffer);
    let offset = 0;
    headerView.setUint32(offset, header.magic); offset += 4;
    headerView.setUint32(offset, header.version); offset += 4;
    // Write type string length + data
    const typeBytes = new TextEncoder().encode(header.type);
    headerView.setUint32(offset, typeBytes.byteLength); offset += 4;
    headerView.setUint32(offset, header.dataSize); offset += 4;
    headerView.setUint32(offset, header.checksum); offset += 4;

    // Combine header + type + json
    const totalSize = headerBuffer.byteLength + typeBytes.byteLength + jsonBytes.byteLength;
    const buffer = new ArrayBuffer(totalSize);
    const combined = new Uint8Array(buffer);

    combined.set(new Uint8Array(headerBuffer), 0);
    combined.set(typeBytes, headerBuffer.byteLength);
    combined.set(jsonBytes, headerBuffer.byteLength + typeBytes.byteLength);

    return buffer;
  }

  /**
   * Deserialize from binary format
   */
  static fromBinary(buffer: ArrayBuffer): any {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);

    let offset = 0;
    const magic = view.getUint32(offset); offset += 4;
    if (magic !== this.MAGIC_NUMBER) {
      throw new Error('Invalid binary format: magic number mismatch.');
    }

    const version = view.getUint32(offset); offset += 4;
    if (version > this.CURRENT_VERSION) {
      throw new Error(`Unsupported format version: ${version}.`);
    }

    const typeLen = view.getUint32(offset); offset += 4;
    const dataSize = view.getUint32(offset); offset += 4;
    const checksum = view.getUint32(offset); offset += 4;

    // Read type string
    const typeBytes = bytes.slice(offset, offset + typeLen);
    offset += typeLen;
    const _type = new TextDecoder().decode(typeBytes);
    void _type; // type field reserved for migration logic

    // Read data
    const jsonBytes = bytes.slice(offset, offset + dataSize);

    // Verify checksum
    const computedChecksum = this.computeChecksum(jsonBytes);
    if (computedChecksum !== checksum) {
      throw new Error('Data corruption detected: checksum mismatch.');
    }

    const json = new TextDecoder().decode(jsonBytes);
    return JSON.parse(json);
  }

  /**
   * Compute a simple checksum for data integrity
   */
  private static computeChecksum(data: Uint8Array): number {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data[i];
      hash |= 0; // Convert to 32-bit integer
    }
    return hash >>> 0; // Ensure unsigned
  }

  /**
   * Clone an object deeply using structured clone
   */
  static deepClone<T>(obj: T): T {
    return this.fromJSON(this.toJSON(obj));
  }

  /**
   * Compare two values for equality (deep comparison)
   */
  static deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return a === b;

    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!this.deepEqual(a[i], b[i])) return false;
      }
      return true;
    }

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!this.deepEqual(a[key], b[key])) return false;
    }

    return true;
  }
}
