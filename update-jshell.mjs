#!/usr/bin/env node
// update-jshell.mjs — Rebuilds JShell assets from Temurin JDK 17
//
// Downloads Eclipse Temurin JDK 17, extracts the jdk.compiler and jdk.jshell
// modules, patches TaskFactory for CheerpJ compatibility, and compiles
// JShellBridge.java. All output goes to public/jshell/.
//
// Prerequisites: Java 17+ (jmod, jar, javac commands on PATH)
// Usage: npm run update-jshell

import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET_DIR = join(__dirname, 'public', 'jshell');
const SRC_DIR = join(__dirname, 'src');
const TEMP = join(tmpdir(), 'jshell-build-' + Date.now());

// Detect OS for Adoptium download
const PLATFORM = process.platform === 'win32' ? 'windows'
    : process.platform === 'darwin' ? 'mac' : 'linux';
const ARCH = process.arch === 'arm64' ? 'aarch64' : 'x64';
const EXT = PLATFORM === 'windows' ? 'zip' : 'tar.gz';
const JDK_URL = `https://api.adoptium.net/v3/binary/latest/17/ga/${PLATFORM}/${ARCH}/jdk/hotspot/normal/eclipse?project=jdk`;

// Modules needed by JShell (excluding jdk.compiler which is separate)
const JSHELL_MODULES = [
    'jdk.jshell', 'java.compiler', 'jdk.jdi', 'jdk.internal.opt',
    'jdk.internal.le', 'jdk.internal.ed', 'java.prefs', 'java.logging'
];

function run(cmd, opts = {}) {
    return execSync(cmd, { stdio: 'pipe', encoding: 'utf-8', ...opts }).trim();
}

function ensureJava() {
    try {
        const ver = run('java -version 2>&1');
        console.log('Java detectado:', ver.split('\n')[0]);
    } catch {
        console.error('ERROR: Java 17+ no encontrado en PATH.');
        console.error('Instala Temurin JDK 17: https://adoptium.net/');
        process.exit(1);
    }
}

async function downloadJDK() {
    const archivePath = join(TEMP, `jdk17.${EXT}`);
    if (existsSync(archivePath)) return archivePath;

    console.log(`\nDescargando Temurin JDK 17 para ${PLATFORM}/${ARCH}...`);
    console.log(`  URL: ${JDK_URL}`);

    const response = await fetch(JDK_URL, { redirect: 'follow' });
    if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(archivePath, buffer);
    const size = (buffer.length / 1024 / 1024).toFixed(1);
    console.log(`  Descargado: ${size} MB`);
    return archivePath;
}

function extractJMods(archivePath) {
    console.log('\nExtrayendo jmods...');
    const extractDir = join(TEMP, 'jdk');
    mkdirSync(extractDir, { recursive: true });

    if (EXT === 'zip') {
        // Use jar to extract zip (available everywhere Java is)
        run(`jar xf "${archivePath}"`, { cwd: extractDir });
    } else {
        run(`tar xf "${archivePath}" -C "${extractDir}"`);
    }

    // Find jmods directory (nested under jdk-17.x.x/)
    const entries = require('node:fs').readdirSync(extractDir);
    const jdkDir = entries.find(e => e.startsWith('jdk-'));
    if (!jdkDir) throw new Error('JDK directory not found in archive');
    return join(extractDir, jdkDir, 'jmods');
}

function buildCompilerJar(jmodsDir) {
    console.log('\nConstruyendo jdk.compiler_17.jar...');
    const workDir = join(TEMP, 'compiler');
    const classesDir = join(workDir, 'classes');
    mkdirSync(classesDir, { recursive: true });

    const jmod = join(jmodsDir, 'jdk.compiler.jmod');
    const extractDir = join(workDir, 'extract');
    run(`jmod extract --dir "${extractDir}" "${jmod}"`);
    cpSync(join(extractDir, 'classes'), classesDir, { recursive: true });

    const jarPath = join(TARGET_DIR, 'jdk.compiler_17.jar');
    run(`jar cf "${jarPath}" .`, { cwd: classesDir });
    const size = (readFileSync(jarPath).length / 1024 / 1024).toFixed(1);
    console.log(`  jdk.compiler_17.jar: ${size} MB`);
}

function buildJShellJar(jmodsDir) {
    console.log('\nConstruyendo jdk.jshell.jar...');
    const workDir = join(TEMP, 'jshell');
    const classesDir = join(workDir, 'classes');
    mkdirSync(classesDir, { recursive: true });

    // Extract all required modules
    for (const mod of JSHELL_MODULES) {
        const jmod = join(jmodsDir, `${mod}.jmod`);
        const extractDir = join(workDir, 'extract');
        mkdirSync(extractDir, { recursive: true });
        run(`jmod extract --dir "${extractDir}" "${jmod}"`);
        cpSync(join(extractDir, 'classes'), classesDir, { recursive: true });
        rmSync(extractDir, { recursive: true, force: true });
    }

    // Add service registrations
    const servicesDir = join(classesDir, 'META-INF', 'services');
    mkdirSync(servicesDir, { recursive: true });

    writeFileSync(join(servicesDir, 'jdk.jshell.spi.ExecutionControlProvider'),
        'jdk.jshell.execution.LocalExecutionControlProvider\n'
        + 'jdk.jshell.execution.FailOverExecutionControlProvider\n');

    writeFileSync(join(servicesDir, 'javax.tools.JavaCompiler'),
        'com.sun.tools.javac.api.JavacTool\n');

    // Create CompilerFixer.java and compile it
    console.log('  Creando CompilerFixer (parche para CheerpJ)...');
    const fixerSrc = join(workDir, 'CompilerFixer.java');
    writeFileSync(fixerSrc, `package jdk.jshell;
import javax.tools.JavaCompiler;
import java.util.ServiceLoader;
public class CompilerFixer {
    public static JavaCompiler getJavaCompilerBridge() {
        for (JavaCompiler c : ServiceLoader.load(JavaCompiler.class)) return c;
        try {
            return (JavaCompiler) Class.forName("com.sun.tools.javac.api.JavacTool")
                .getConstructor().newInstance();
        } catch (Exception e) { return null; }
    }
}
`);
    run(`javac --release 8 -cp "${classesDir}" -d "${join(workDir, 'patch')}" "${fixerSrc}"`);
    cpSync(join(workDir, 'patch', 'jdk', 'jshell', 'CompilerFixer.class'),
        join(classesDir, 'jdk', 'jshell', 'CompilerFixer.class'));

    // Patch TaskFactory.class — binary replace of same-length strings
    console.log('  Parcheando TaskFactory.class...');
    const taskFactoryPath = join(classesDir, 'jdk', 'jshell', 'TaskFactory.class');
    let data = readFileSync(taskFactoryPath);
    // javax/tools/ToolProvider (24 chars) → jdk/jshell/CompilerFixer (24 chars)
    data = bufferReplace(data, Buffer.from('javax/tools/ToolProvider'), Buffer.from('jdk/jshell/CompilerFixer'));
    // getSystemJavaCompiler (21 chars) → getJavaCompilerBridge (21 chars)
    data = bufferReplace(data, Buffer.from('getSystemJavaCompiler'), Buffer.from('getJavaCompilerBridge'));
    writeFileSync(taskFactoryPath, data);

    // Build JAR
    const jarPath = join(TARGET_DIR, 'jdk.jshell.jar');
    run(`jar cf "${jarPath}" .`, { cwd: classesDir });
    const size = (readFileSync(jarPath).length / 1024 / 1024).toFixed(1);
    console.log(`  jdk.jshell.jar: ${size} MB`);
}

function bufferReplace(buf, search, replace) {
    const idx = buf.indexOf(search);
    if (idx === -1) {
        console.warn(`  ADVERTENCIA: no se encontro "${search.toString()}" en el bytecode`);
        return buf;
    }
    const result = Buffer.from(buf);
    replace.copy(result, idx);
    return result;
}

function buildBridge() {
    console.log('\nCompilando JShellBridge...');
    const bridgeSrc = join(SRC_DIR, 'JShellBridge.java');
    if (!existsSync(bridgeSrc)) {
        console.warn('  ADVERTENCIA: src/JShellBridge.java no encontrado, saltando...');
        return;
    }
    const buildDir = join(TEMP, 'bridge');
    mkdirSync(buildDir, { recursive: true });

    const sep = process.platform === 'win32' ? ';' : ':';
    const cp = `${join(TARGET_DIR, 'jdk.jshell.jar')}${sep}${join(TARGET_DIR, 'jdk.compiler_17.jar')}`;
    run(`javac --release 17 -cp "${cp}" -d "${buildDir}" "${bridgeSrc}"`);

    // Copy all .class files
    const fs = require('node:fs');
    for (const f of fs.readdirSync(buildDir)) {
        if (f.endsWith('.class')) {
            cpSync(join(buildDir, f), join(TARGET_DIR, f));
            console.log(`  ${f}`);
        }
    }
}

// --- Main ---

async function main() {
    ensureJava();
    mkdirSync(TEMP, { recursive: true });
    mkdirSync(TARGET_DIR, { recursive: true });

    try {
        const archivePath = await downloadJDK();
        const jmodsDir = extractJMods(archivePath);
        buildCompilerJar(jmodsDir);
        buildJShellJar(jmodsDir);
        buildBridge();

        // Write version.json
        const versionInfo = {
            jdkVersion: '17',
            source: 'Eclipse Temurin (Adoptium)',
            cheerpjVersion: '4.2',
            updatedAt: new Date().toISOString(),
        };
        writeFileSync(join(TARGET_DIR, 'version.json'), JSON.stringify(versionInfo, null, 2) + '\n');

        console.log('\nversion.json guardado en public/jshell/');
        console.log('\nJShell actualizado.');
    } finally {
        // Cleanup temp
        console.log('\nLimpiando archivos temporales...');
        rmSync(TEMP, { recursive: true, force: true });
    }
}

main().catch(err => {
    console.error('\nERROR:', err.message);
    rmSync(TEMP, { recursive: true, force: true });
    process.exit(1);
});
