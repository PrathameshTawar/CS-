/**
 * mode-select.test.ts
 *
 * Unit tests for the CLASSIC / AI boot screen routing (Requirement 26, T0.3).
 * The query-param fast-boot resolver is a pure static method, so it is tested
 * without a DOM.
 */

import { ModeSelect } from '../../src/ui/modes/ModeSelect';

describe('ModeSelect.resolveFromQuery', () => {
  it('returns classic for ?mode=classic', () => {
    expect(ModeSelect.resolveFromQuery(new URLSearchParams('mode=classic'))).toBe('classic');
  });

  it('returns ai for ?mode=ai', () => {
    expect(ModeSelect.resolveFromQuery(new URLSearchParams('mode=ai'))).toBe('ai');
  });

  it('returns creator for ?mode=creator', () => {
    expect(ModeSelect.resolveFromQuery(new URLSearchParams('mode=creator'))).toBe('creator');
  });

  it('returns null when the mode param is absent', () => {
    expect(ModeSelect.resolveFromQuery(new URLSearchParams('biome=city&seed=42'))).toBeNull();
    expect(ModeSelect.resolveFromQuery(new URLSearchParams(''))).toBeNull();
  });

  it('returns null for an invalid mode value', () => {
    expect(ModeSelect.resolveFromQuery(new URLSearchParams('mode=coop'))).toBeNull();
    expect(ModeSelect.resolveFromQuery(new URLSearchParams('mode=CLASSIC'))).toBeNull();
  });
});
