/**
 * CreatorUI.ts
 *
 * DOM UI overlay for Creator Mode (Requirement 34, R34.3).
 * Exposes a chat-style input panel for natural language creator commands and
 * a visible chronological event log of applied mutations.
 *
 * @module Modes
 */
import { EventBus } from '../../engine/events/EventBus';
import type { CreatorMutation } from './CreatorMode';
export declare class CreatorUI {
    private el;
    private logEl;
    private inputEl;
    private readonly bus;
    private readonly onSubmit;
    private busDisposer;
    constructor(bus: EventBus, onSubmit: (command: string) => void);
    mount(container: HTMLElement): void;
    renderLog(mutations: CreatorMutation[]): void;
    unmount(): void;
}
//# sourceMappingURL=CreatorUI.d.ts.map