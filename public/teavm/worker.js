Error.stackTraceLimit = 50;
// Suppress noisy WASM runtime logs
const _log = console.log;
console.log = (...args) => {
    const msg = args[0];
    if (typeof msg === 'string' && (msg.startsWith('Message received') || msg.startsWith('Done processing'))) return;
    _log.apply(console, args);
};

// Catch WASM traps and other unhandled errors, relay to main thread
self.addEventListener('error', (event) => {
    event.preventDefault();
    try {
        self.postMessage({ command: 'worker-error', message: event.message || 'Error interno del compilador' });
    } catch (e) { /* ignore */ }
});

self.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    try {
        self.postMessage({ command: 'worker-error', message: event.reason?.message || 'Error interno del compilador' });
    } catch (e) { /* ignore */ }
});

(async function() {
    try {
        let teavmSupport = await import('./compiler.wasm-runtime.js');
        let teavm = await teavmSupport.load("compiler.wasm", {
            stackDeobfuscator: {
                enabled: false
            }
        });

        teavm.exports.installWorker();
    } catch (e) {
        self.postMessage({ command: 'worker-error', message: e.message || 'Failed to load compiler' });
    }
})();
