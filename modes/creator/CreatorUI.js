/**
 * CreatorUI.ts
 *
 * DOM UI overlay for Creator Mode (Requirement 34, R34.3).
 * Exposes a chat-style input panel for natural language creator commands and
 * a visible chronological event log of applied mutations.
 *
 * @module Modes
 */
export class CreatorUI {
    el = null;
    logEl = null;
    inputEl = null;
    bus;
    onSubmit;
    busDisposer = null;
    constructor(bus, onSubmit) {
        this.bus = bus;
        this.onSubmit = onSubmit;
    }
    mount(container) {
        this.unmount();
        this.el = document.createElement('div');
        this.el.className = 'creator-ui';
        this.el.style.cssText =
            'position:absolute;bottom:20px;left:20px;width:380px;max-height:360px;' +
                'background:rgba(12,16,24,0.92);border:1px solid rgba(124,58,237,0.5);' +
                'border-radius:12px;display:flex;flex-direction:column;padding:12px;' +
                'color:#fff;font-family:system-ui;z-index:25;box-shadow:0 8px 30px rgba(0,0,0,0.6);';
        this.el.innerHTML = `
      <style>
        .creator-title { font-size:14px; font-weight:800; letter-spacing:1px; color:#a78bfa; margin:0 0 8px; display:flex; justify-content:space-between; align-items:center; }
        .creator-badge { font-size:10px; background:rgba(124,58,237,0.3); color:#ddd; padding:2px 8px; border-radius:999px; }
        .creator-log-box { flex:1; min-height:120px; max-height:220px; overflow-y:auto; margin-bottom:10px; padding:8px; background:rgba(0,0,0,0.35); border-radius:8px; border:1px solid rgba(255,255,255,0.08); font-size:12px; }
        .creator-entry { padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; }
        .creator-entry-cmd { font-weight:700; color:#4ade80; }
        .creator-entry-dtl { color:#cbd5e1; font-size:11px; }
        .creator-form { display:flex; gap:6px; }
        .creator-input { flex:1; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2); border-radius:6px; padding:8px 10px; color:#fff; font-size:13px; outline:none; }
        .creator-input:focus { border-color:#a78bfa; }
        .creator-btn { background:#7c3aed; color:#fff; border:none; border-radius:6px; padding:8px 14px; font-weight:700; font-size:12px; cursor:pointer; }
        .creator-btn:hover { background:#6d28d9; }
      </style>
      <div class="creator-title">
        <span>🛠 CREATOR PLAYGROUND</span>
        <span class="creator-badge">LIVE LEVEL EDITOR</span>
      </div>
      <div class="creator-log-box" id="creatorLogBox">
        <div style="opacity:0.6;font-style:italic;">No mutations applied yet. Type a command below...</div>
      </div>
      <form class="creator-form" id="creatorForm">
        <input type="text" class="creator-input" id="creatorInput" placeholder="e.g. 'add enemy', 'make it night'..." autocomplete="off" />
        <button type="submit" class="creator-btn">Send</button>
      </form>
    `;
        container.appendChild(this.el);
        this.logEl = this.el.querySelector('#creatorLogBox');
        this.inputEl = this.el.querySelector('#creatorInput');
        const form = this.el.querySelector('#creatorForm');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!this.inputEl)
                return;
            const val = this.inputEl.value.trim();
            if (val) {
                this.onSubmit(val);
                this.inputEl.value = '';
            }
        });
        this.busDisposer = this.bus.on('creator.log.update', (mutations) => {
            this.renderLog(mutations);
        });
    }
    renderLog(mutations) {
        if (!this.logEl)
            return;
        if (mutations.length === 0) {
            this.logEl.innerHTML = '<div style="opacity:0.6;font-style:italic;">No mutations applied yet. Type a command below...</div>';
            return;
        }
        this.logEl.innerHTML = mutations
            .map((m) => `
        <div class="creator-entry" data-id="${m.id}">
          <span class="creator-entry-cmd">“${escapeHtml(m.rawCommand)}”</span>
          <span class="creator-entry-dtl">${escapeHtml(m.details)}</span>
        </div>
      `)
            .join('');
        this.logEl.scrollTop = this.logEl.scrollHeight;
    }
    unmount() {
        this.busDisposer?.();
        this.busDisposer = null;
        this.el?.remove();
        this.el = null;
        this.logEl = null;
        this.inputEl = null;
    }
}
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
//# sourceMappingURL=CreatorUI.js.map