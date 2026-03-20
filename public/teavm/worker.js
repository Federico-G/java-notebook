Error.stackTraceLimit = 50;
// Suppress noisy WASM runtime logs
const _log = console.log;
console.log = (...args) => {
    const msg = args[0];
    if (typeof msg === 'string' && (msg.startsWith('Message received') || msg.startsWith('Done processing'))) return;
    _log.apply(console, args);
};
(async function() {
    let teavmSupport = await import('./compiler.wasm-runtime.js');
    let teavm = await teavmSupport.load("compiler.wasm", {
        stackDeobfuscator: {
            enabled: false
        }
    });

    teavm.exports.installWorker();
})();
