/*
 * run-frame.js — Iframe-side execution handler
 * Adapted from TeaVM playground's frame.js (Apache 2.0)
 * Receives compiled WASM code, executes main(), captures stdout/stderr
 */

import { load } from '../teavm/compiler.wasm-runtime.js';

Error.stackTraceLimit = 100;

window.addEventListener("message", async function(event) {
    let request = event.data;
    if (!request || !request.code) return;

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

    // Flush any remaining buffered output
    flushBuffers();
    event.source.postMessage({ status: "complete" }, "*");
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
