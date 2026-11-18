import { initializeSillyTavern } from './src/st/adapter.js';

let instance = null;
let pending = null;

export async function activate() {
    pending ??= initializeSillyTavern()
        .then(app => {
            instance = app;
            return app;
        })
        .catch(err => {
            pending = null;
            const host = globalThis.document?.querySelector('#extensions_settings');
            if (host) {
                const p = globalThis.document.createElement('p');
                p.textContent = 'CLODEx RP Studio failed to load. Require SillyTavern 1.19.0+.';
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
