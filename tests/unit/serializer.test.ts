/**
 * serializer.test.ts
 *
 * Unit tests for the existing Serializer engine module.
 */

import { Serializer } from '../../src/engine/serialization/Serializer';

describe('Serializer', () => {
  it('round-trips simple JSON', () => {
    const data = { name: 'rifle', damage: 28, tags: ['a', 'b'] };
    const json = Serializer.toJSON(data);
    const back = Serializer.fromJSON(json);
    expect(back).toEqual(data);
  });

  it('round-trips typed arrays, maps, and sets', () => {
    const data = {
      vec: new Float32Array([1, 2, 3]),
      map: new Map<string, number>([['hp', 100]]),
      set: new Set([1, 2, 3]),
    };
    const json = Serializer.toJSON(data);
    const back = Serializer.fromJSON(json);
    expect(back.vec).toEqual(new Float32Array([1, 2, 3]));
    expect(back.map.get('hp')).toBe(100);
    expect(back.set.has(2)).toBe(true);
  });

  it('binary format round-trips with checksum validation', () => {
    const data = { health: 87, name: 'player' };
    const buffer = Serializer.toBinary(data);
    const back = Serializer.fromBinary(buffer);
    expect(back).toEqual(data);
  });

  it('binary format rejects corrupt data', () => {
    const data = { health: 87 };
    const buffer = Serializer.toBinary(data);
    // Corrupt the payload
    const bytes = new Uint8Array(buffer);
    bytes[bytes.length - 1] ^= 0xff;
    const corrupted = bytes.buffer;
    expect(() => Serializer.fromBinary(corrupted)).toThrow();
  });

  it('deep clone and deep equal work', () => {
    const obj = { a: 1, b: { c: [1, 2, 3] } };
    const clone = Serializer.deepClone(obj);
    expect(clone).toEqual(obj);
    expect(Serializer.deepEqual(obj, clone)).toBe(true);
    expect(Serializer.deepEqual(obj, { a: 1, b: { c: [1, 2, 4] } })).toBe(false);
  });
});
