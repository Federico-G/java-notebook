#!/usr/bin/env node
// update-teavm.mjs — Downloads latest teavm-javac artifacts from teavm.org
//
// Source: https://github.com/konsoletyper/teavm-javac
// Artifacts: https://teavm.org/playground/
// Usage: npm run update-teavm

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET_DIR = join(__dirname, 'public', 'teavm');
const BASE_URL = 'https://teavm.org/playground';
const VERSIONS_URL = 'https://raw.githubusercontent.com/konsoletyper/teavm-javac/master/gradle/libs.versions.toml';

const ARTIFACTS = [
    'compiler.wasm',
    'compiler.wasm-runtime.js',
    'compile-classlib-teavm.bin',
    'runtime-classlib-teavm.bin',
];

mkdirSync(TARGET_DIR, { recursive: true });

// 1. Fetch version info
console.log('Consultando version...');
let teavmVersion = 'unknown';
try {
    const resp = await fetch(VERSIONS_URL);
    if (resp.ok) {
        const text = await resp.text();
        const match = text.match(/^teavm\s*=\s*"(.+)"/m);
        if (match) teavmVersion = match[1];
    }
} catch { /* ignore */ }

console.log(`Version de TeaVM en repositorio: ${teavmVersion}\n`);

// 2. Download artifacts
console.log('Descargando artefactos de teavm.org/playground/...\n');

let failed = false;
let buildDate = null;

for (const file of ARTIFACTS) {
    const url = `${BASE_URL}/${file}`;
    process.stdout.write(`  ${file} ... `);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.log(`ERROR (${response.status})`);
            failed = true;
            continue;
        }
        if (!buildDate && response.headers.get('last-modified')) {
            buildDate = response.headers.get('last-modified');
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        writeFileSync(join(TARGET_DIR, file), buffer);
        const size = (buffer.length / 1024 / 1024).toFixed(1);
        console.log(`${size} MB`);
    } catch (err) {
        console.log(`ERROR: ${err.message}`);
        failed = true;
    }
}

if (failed) {
    console.error('\nAlgunos artefactos no se pudieron descargar.');
    process.exit(1);
}

// 3. Write version.json
const versionInfo = {
    teavmVersion,
    buildDate: buildDate || 'unknown',
    updatedAt: new Date().toISOString(),
    source: 'https://github.com/konsoletyper/teavm-javac',
    artifacts: BASE_URL,
};

writeFileSync(join(TARGET_DIR, 'version.json'), JSON.stringify(versionInfo, null, 2) + '\n');
console.log(`\nversion.json guardado en public/teavm/`);
console.log(`  teavm: ${teavmVersion}`);
console.log(`  build: ${buildDate}`);
console.log('\nTeaVM actualizado.');
