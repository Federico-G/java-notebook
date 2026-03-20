/*
 * run-frame.js — Iframe-side execution handler
 * Adapted from TeaVM playground's frame.js (Apache 2.0)
 * Receives compiled WASM code, executes main(), captures stdout/stderr
 */

import { load } from '../teavm/compiler.wasm-runtime.js';

Error.stackTraceLimit = 100;

// Safety net for WASM traps that escape try/catch
let executionFinished = false;

window.addEventListener('error', (event) => {
    if (executionFinished) return;
    event.preventDefault();
    executionFinished = true;
    try {
        flushBuffers();
        window.parent.postMessage({ command: "stderr", line: "Runtime error: " + (event.error?.message || event.message) }, "*");
        window.parent.postMessage({ status: "failed", errorMessage: event.error?.message || event.message }, "*");
    } catch (e) { /* ignore */ }
});

window.addEventListener('unhandledrejection', (event) => {
    if (executionFinished) return;
    event.preventDefault();
    executionFinished = true;
    const msg = event.reason?.message || String(event.reason);
    try {
        flushBuffers();
        window.parent.postMessage({ command: "stderr", line: "Runtime error: " + msg }, "*");
        window.parent.postMessage({ status: "failed", errorMessage: msg }, "*");
    } catch (e) { /* ignore */ }
});

window.addEventListener("message", async function(event) {
    let request = event.data;
    if (!request || !request.code) return;
    executionFinished = false;

    let module;
    try {
        module = await load(request.code, {
            stackDeobfuscator: {
                enabled: false
            },
            installImports(o) {
                o.teavmConsole.putcharStdout = putStdout;
                o.teavmConsole.putcharStderr = putStderr;
            }
        });
    } catch (e) {
        event.source.postMessage({ status: "failed", errorMessage: e.message }, "*");
        executionFinished = true;
        return;
    }

    event.source.postMessage({ status: "loaded" }, "*");

    try {
        module.exports.main([]);
    } catch (e) {
        // Flush buffers before reporting error
        flushBuffers();
        event.source.postMessage({ command: "stderr", line: "Runtime error: " + e.message }, "*");
    }

    if (!executionFinished) {
        // Flush any remaining buffered output
        flushBuffers();
        event.source.postMessage({ status: "complete" }, "*");
        executionFinished = true;
    }
});

export function start() {
    window.parent.postMessage({ command: "ready" }, "*");
}

let stdoutBuffer = "";
function putStdout(ch) {
    if (ch === 0xA) {
        window.parent.postMessage({ command: "stdout", line: stdoutBuffer }, "*");
        stdoutBuffer = "";
    } else {
        stdoutBuffer += String.fromCharCode(ch);
    }
}

let stderrBuffer = "";
function putStderr(ch) {
    if (ch === 0xA) {
        window.parent.postMessage({ command: "stderr", line: stderrBuffer }, "*");
        stderrBuffer = "";
    } else {
        stderrBuffer += String.fromCharCode(ch);
    }
}

function flushBuffers() {
    if (stdoutBuffer) {
        window.parent.postMessage({ command: "stdout", line: stdoutBuffer }, "*");
        stdoutBuffer = "";
    }
    if (stderrBuffer) {
        window.parent.postMessage({ command: "stderr", line: stderrBuffer }, "*");
        stderrBuffer = "";
    }
}
