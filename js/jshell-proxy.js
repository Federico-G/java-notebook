// jshell-proxy.js — CheerpJ + JShell proxy
//
// Replaces compiler-worker-proxy.js + execution-manager.js.
// Manages CheerpJ initialization, JShellBridge lifecycle, and output capture.

/* global cheerpjInit, cheerpjRunLibrary, cheerpOSAddStringFile */

let jshellBridge = null;
let ready = false;
let readyResolve = null;
const readyPromise = new Promise(r => { readyResolve = r; });
let progressCallback = null;

// --- Console capture (CheerpJ routes System.out to #console DOM element) ---

let consoleEl = null;
let consoleSnapshot = '';

function flushConsole() {
    const text = consoleEl.textContent;
    const newText = text.slice(consoleSnapshot.length);
    consoleSnapshot = text;
    return newText;
}

function clearConsoleSnapshot() {
    consoleSnapshot = consoleEl.textContent;
}

function waitForConsole(timeoutMs = 150) {
    return new Promise(resolve => {
        if (consoleEl.textContent.length > consoleSnapshot.length) {
            resolve();
            return;
        }
        let resolved = false;
        const done = () => { if (!resolved) { resolved = true; observer.disconnect(); resolve(); } };
        const observer = new MutationObserver(done);
        observer.observe(consoleEl, { childList: true, characterData: true, subtree: true });
        setTimeout(done, timeoutMs);
    });
}

// --- Serialization (only one eval at a time — shared output capture state) ---

let evalChain = Promise.resolve();

function serialized(fn) {
    const p = evalChain.then(() => readyPromise).then(fn);
    evalChain = p.catch(() => {}); // swallow for chain continuity
    return p;
}

// --- Progress ---

export function setProgressCallback(cb) {
    progressCallback = cb;
}

function reportProgress(phase) {
    if (progressCallback) progressCallback(phase);
}

// --- Load precompiled .class files into CheerpJ virtual filesystem ---

async function loadPrecompiled(className) {
    const url = `jshell/${className}.class`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to load ${className}.class (${resp.status})`);
    cheerpOSAddStringFile(`/str/${className}.class`, new Uint8Array(await resp.arrayBuffer()));
}

// --- Public API ---

export async function initJShell() {
    consoleEl = document.getElementById('console');

    reportProgress('loading-cheerpj');
    await cheerpjInit({ status: 'none', version: 17 });

    reportProgress('loading-jshell');
    await loadPrecompiled('JShellBridge');
    await loadPrecompiled('JShellBridge$SwitchOutputStream');
    await loadPrecompiled('JShellBridge$SessionState');

    const jar = (name) => '/app' + new URL(`jshell/${name}`, location.href).pathname;
    const lib = await cheerpjRunLibrary(
        jar('jdk.jshell.jar') + ':' + jar('jdk.compiler_17.jar') + ':/str/');
    jshellBridge = await lib.JShellBridge;

    // Warmup — first JShell creation is slow; subsequent ones are fast
    reportProgress('warming-up');
    const warmupId = '__warmup__';
    await callBridge('init', warmupId);
    consoleEl.textContent = '';
    consoleSnapshot = '';
    await callBridge('eval', warmupId, '1+1');
    flushConsole();
    await callBridge('close', warmupId);
    // Clear CheerpJ console so first real eval starts clean
    consoleEl.textContent = '';
    consoleSnapshot = '';

    ready = true;
    readyResolve();
    reportProgress('ready');
}

export function initSession(sessionId) {
    return serialized(async () => {
        clearConsoleSnapshot();
        const result = await callBridge('init', sessionId);
        if (!result.includes('OK')) throw new Error('JShell init: ' + result);
    });
}

export function evalCode(sessionId, code) {
    return serialized(async () => {
        const startTime = performance.now();
        clearConsoleSnapshot();
        const javaResult = await callBridge('eval', sessionId, code);

        // Always wait for CheerpJ to flush stdout to #console DOM.
        // CheerpJ routes System.out asynchronously — output may arrive after
        // the Java eval() call returns, especially on the first execution.
        await waitForConsole();
        const consoleOutput = flushConsole();

        // Merge both output sources
        const combined = (javaResult || '') + consoleOutput;
        const timeMs = Math.round(performance.now() - startTime);

        // Parse: lines starting with @@ERR@@ are errors, rest is output
        const output = [];
        const errors = [];
        if (combined) {
            for (const line of combined.split('\n')) {
                if (line.startsWith('@@ERR@@')) {
                    errors.push(line.slice(7));
                } else if (line) {
                    output.push(line);
                }
            }
        }

        return { output, errors, timeMs };
    });
}

export function resetSession(sessionId) {
    return serialized(async () => {
        clearConsoleSnapshot();
        const result = await callBridge('reset', sessionId);
        flushConsole();
        if (!result.includes('OK')) throw new Error('JShell reset: ' + result);
    });
}

export function closeSession(sessionId) {
    return serialized(async () => {
        clearConsoleSnapshot();
        await callBridge('close', sessionId);
        flushConsole();
    });
}

export function isReady() {
    return ready;
}

// --- Internal: call JShellBridge static methods ---

async function callBridge(method, ...args) {
    const javaResult = await jshellBridge[method](...args);
    if (javaResult == null) return '';
    return await javaResult.toString();
}
