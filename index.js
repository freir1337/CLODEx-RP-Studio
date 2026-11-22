import { initializeSillyTavern } from './src/st/adapter.js';

let instance = null;
let pending = null;

export async function activate() {
    if (instance) return instance;
    pending ??= initializeSillyTavern()
        .then(app => {
            instance = app;
            return app;
        })
        .catch(err => {
            pending = null;
            globalThis.console?.error?.('[CLODEx RP Studio] Failed to load:', err);
            const host = globalThis.document?.querySelector('#extensions_settings');
            if (host) {
                const p = globalThis.document.createElement('p');
                p.textContent = 'CLODEx RP Studio failed to load. Check browser console (F12).';
                host.append(p);
            }
            throw err;
        });
    return pending;
}

export function deactivate() {
    instance?.dispose();
    instance = null;
    pending = null;
}

// Auto-activate when loaded as a standard SillyTavern module script
if (typeof globalThis.window !== 'undefined') {
    const boot = () => {
        activate().catch(() => {});
    };
    const ctx = globalThis.SillyTavern?.getContext?.();
    if (ctx?.eventSource && ctx?.event_types?.APP_READY) {
        ctx.eventSource.on(ctx.event_types.APP_READY, boot);
    }
    if (globalThis.document?.readyState === 'complete') {
        setTimeout(boot, 100);
    } else {
        globalThis.window.addEventListener('load', () => setTimeout(boot, 100), { once: true });
    }
}
