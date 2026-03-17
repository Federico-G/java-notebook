// compiler-worker-proxy.js — Promise-based proxy to the teavm-javac compilation Web Worker
//
// Worker protocol (from teavm-javac README):
//   Worker → Main: { command: "initialized" }
//   Main → Worker: { command: "load-classlib", id, url, runtimeUrl }
//   Worker → Main: { command: "ok", id }
//   Main → Worker: { command: "compile", id, text }
//   Worker → Main: { command: "compiler-diagnostic"|"diagnostic", id, severity, fileName, lineNumber, message, ... }
//   Worker → Main: { command: "compilation-complete", id, status: "successful"|"errors", script: Int8Array }

let worker = null;
let initialized = false;
let initPromise = null;
let messageHandlers = [];
let onProgress = null;
let msgIdCounter = 0;

function nextId() {
    return 'msg-' + (msgIdCounter++);
}

export function setProgressCallback(cb) {
    onProgress = cb;
}

export function initCompiler() {
    if (initPromise) return initPromise;

    initPromise = new Promise((resolve, reject) => {
        // worker.js is a classic script (not module), uses dynamic import() internally
        worker = new Worker('teavm/worker.js');

        worker.addEventListener('message', (event) => {
            handleMessage(event.data);
        });

        worker.addEventListener('error', (event) => {
            reject(new Error('Worker error: ' + event.message));
        });

        // Wait for "initialized", then load classlibs
        const initHandler = (msg) => {
            if (msg.command === 'initialized') {
                removeHandler(initHandler);
                if (onProgress) onProgress('loading-classlibs');

                const classlibUrl = new URL('teavm/compile-classlib-teavm.bin', window.location.href).href;
                const runtimeUrl = new URL('teavm/runtime-classlib-teavm.bin', window.location.href).href;
                const loadId = nextId();

                const classlibHandler = (msg) => {
                    if (msg.id === loadId && msg.command === 'ok') {
                        removeHandler(classlibHandler);
                        initialized = true;
                        if (onProgress) onProgress('ready');
                        resolve();
                    }
                };
                addHandler(classlibHandler);

                worker.postMessage({
                    command: 'load-classlib',
                    id: loadId,
                    url: classlibUrl,
                    runtimeUrl: runtimeUrl
                });
            }
        };
        addHandler(initHandler);

        if (onProgress) onProgress('loading-wasm');
    });

    return initPromise;
}

export function compile(javaSource) {
    if (!initialized) {
        return Promise.reject(new Error('Compiler not initialized'));
    }

    return new Promise((resolve) => {
        const diagnostics = [];
        const compileId = nextId();

        const resultHandler = (msg) => {
            if (msg.id !== compileId) return;

            if (msg.command === 'compiler-diagnostic' || msg.command === 'diagnostic') {
                diagnostics.push({
                    type: msg.command === 'compiler-diagnostic' ? 'javac' : 'teavm',
                    severity: msg.severity,
                    message: msg.message,
                    lineNumber: msg.lineNumber,
                    columnNumber: msg.columnNumber,
                    fileName: msg.fileName
                });
            } else if (msg.command === 'compilation-complete') {
                removeHandler(resultHandler);
                resolve({
                    success: msg.status === 'successful',
                    diagnostics: diagnostics,
                    script: msg.script || null  // Int8Array containing WASM module
                });
            }
        };
        addHandler(resultHandler);

        worker.postMessage({
            command: 'compile',
            id: compileId,
            text: javaSource
        });
    });
}

function addHandler(handler) {
    messageHandlers.push(handler);
}

function removeHandler(handler) {
    messageHandlers = messageHandlers.filter(h => h !== handler);
}

function handleMessage(msg) {
    for (const handler of [...messageHandlers]) {
        handler(msg);
    }
}

export function isReady() {
    return initialized;
}
