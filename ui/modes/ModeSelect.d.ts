/**
 * ModeSelect.ts
 *
 * Full-screen CLASSIC / AI boot screen (Requirement 26, T0.3).
 * Mouse + keyboard (1 / 2) selection, and a `?mode=` query-param fast-boot
 * (R26.5). The resolver is a pure static method so it is unit-testable
 * without a DOM.
 *
 * @module UI
 */
import type { GameModeId } from '../../modes/GameMode';
export declare class ModeSelect {
    private el;
    private onSelect;
    private readonly keyHandler;
    /** Parse `?mode=classic|ai|creator`; returns null when absent/invalid (R26.5). */
    static resolveFromQuery(params: URLSearchParams): GameModeId | null;
    /** Show the mode-select overlay over the given container. */
    show(container: HTMLElement, onSelect: (id: GameModeId) => void): void;
    hide(): void;
    private pick;
}
//# sourceMappingURL=ModeSelect.d.ts.map