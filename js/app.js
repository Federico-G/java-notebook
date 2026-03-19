// app.js — Main application bootstrap

import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import { createEmptyNotebook, createCell, fromJSON } from './notebook-model.js';
import { initCompiler, setProgressCallback } from './compiler-worker-proxy.js';
import { updateAllEditorsIndent, updateAllEditorsTheme } from './editor-setup.js';
import { ExecutionManager } from './execution-manager.js';
import {
    importFromFile, exportToFile, setupDragDrop,
    saveAllTabsToStorage, loadTabsFromStorage
} from './ipynb-io.js';
import {
    initTabManager, createTab, switchTab, getActiveTab, getAllTabs, getActiveTabId,
    updateTabFilename
} from './tab-manager.js';

// DOM elements
const container = document.getElementById('notebook-container');
const tabBar = document.getElementById('tab-bar');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingStatus = document.getElementById('loading-status');
const btnImport = document.getElementById('btn-import');
const btnExport = document.getElementById('btn-export');

// Execution manager (shared across all tabs)
const execManager = new ExecutionManager();

let autosaveTimer = null;

async function main() {
    // Init tab manager
    initTabManager(container, tabBar, execManager, onNotebookChanged, newNotebook);

    // Try to restore from localStorage
    const saved = loadTabsFromStorage();
    if (saved && saved.tabs.length > 0) {
        const tabIds = saved.tabs.map(t => createTab(t.notebook, t.filename));
        // Restore the previously active tab
        const savedIdx = saved.tabs.findIndex(t => t.id === saved.activeTabId);
        if (savedIdx >= 0) switchTab(tabIds[savedIdx]);
    } else {
        const nb = createEmptyNotebook();
        nb.cells.push(createCell('code', 'System.out.println("Hello, Java Notebook!");'));
        createTab(nb, 'notebook.ipynb');
    }

    // Setup drag-drop — opens as new tab
    setupDragDrop(container, ({ notebook, filename }) => {
        createTab(notebook, filename);
    });

    // Setup toolbar
    btnImport.addEventListener('click', handleImport);
    btnExport.addEventListener('click', handleExport);

    // Init examples dropdown + settings
    initExamples();
    initSettings();

    // Init compiler
    setProgressCallback(updateLoadingStatus);
    try {
        await initCompiler();
        loadingOverlay.style.display = 'none';
    } catch (e) {
        loadingStatus.textContent = 'Failed to load compiler: ' + e.message;
        loadingStatus.classList.add('error');
        console.error('Compiler init failed:', e);
    }
}

function updateLoadingStatus(phase) {
    switch (phase) {
        case 'loading-wasm':
            loadingStatus.textContent = 'Cargando compilador Java (WASM)...';
            break;
        case 'loading-classlibs':
            loadingStatus.textContent = 'Cargando bibliotecas de clases...';
            break;
        case 'ready':
            loadingStatus.textContent = 'Compilador listo!';
            break;
    }
}

function saveNow() {
    const tabs = getAllTabs();
    const activeId = getActiveTabId();
    saveAllTabsToStorage(tabs, activeId);
}

function onNotebookChanged() {
    saveNow();
}

function newNotebook() {
    const nb = createEmptyNotebook();
    nb.cells.push(createCell('code', ''));
    createTab(nb, 'notebook.ipynb');
}

async function handleImport() {
    try {
        const result = await importFromFile();
        if (result) {
            createTab(result.notebook, result.filename);
        }
    } catch (e) {
        alert('Error al importar: ' + e.message);
    }
}

function handleExport() {
    const tab = getActiveTab();
    if (tab) {
        exportToFile(tab.notebook, tab.filename);
    }
}

// --- Examples ---

async function initExamples() {
    const dropdown = document.getElementById('examples-dropdown');
    const btn = document.getElementById('btn-examples');
    const menu = document.getElementById('examples-menu');
    if (!dropdown || !btn || !menu) return;

    // Toggle dropdown
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('open');
    });
    document.addEventListener('click', () => menu.classList.remove('open'));

    // Load example index
    try {
        const resp = await fetch('examples/index.json');
        if (!resp.ok) {
            dropdown.style.display = 'none';
            return;
        }
        const examples = await resp.json();
        menu.innerHTML = '';
        for (const ex of examples) {
            const item = document.createElement('button');
            item.className = 'dropdown-item';
            item.textContent = ex.name;
            item.addEventListener('click', async () => {
                menu.classList.remove('open');
                try {
                    const r = await fetch('examples/' + ex.filename);
                    const obj = await r.json();
                    const nb = fromJSON(obj);
                    createTab(nb, ex.filename);
                } catch (err) {
                    alert('Error al cargar ejemplo: ' + err.message);
                }
            });
            menu.appendChild(item);
        }
    } catch (e) {
        dropdown.style.display = 'none';
    }
}

// --- Settings ---

const SETTINGS_KEY = 'java-notebook-settings';

function getSettings() {
    try {
        return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch { return {}; }
}

function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// --- Theme ---

const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(mode) {
    const isDark = mode === 'dark' || (mode === 'system' && systemDarkQuery.matches);
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    updateAllEditorsTheme(isDark);
}

// Apply theme immediately from saved settings (before editors are created)
applyTheme(getSettings().theme || 'system');

// Listen for system theme changes (only affects 'system' mode)
systemDarkQuery.addEventListener('change', () => {
    if ((getSettings().theme || 'system') === 'system') {
        applyTheme('system');
    }
});

function initSettings() {
    const dropdown = document.getElementById('settings-dropdown');
    const btn = document.getElementById('btn-settings');
    const menu = document.getElementById('settings-menu');
    if (!dropdown || !btn || !menu) return;

    const settings = getSettings();

    // Toggle
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('open');
    });
    document.addEventListener('click', () => menu.classList.remove('open'));
    menu.addEventListener('click', (e) => e.stopPropagation());

    function updateActive() {
        menu.querySelectorAll('.settings-indent').forEach(el => {
            el.classList.toggle('active', String(settings.indentSize || 4) === el.dataset.size);
        });
        menu.querySelectorAll('.settings-theme').forEach(el => {
            el.classList.toggle('active', (settings.theme || 'system') === el.dataset.theme);
        });
    }
    updateActive();

    // Theme buttons
    menu.querySelectorAll('.settings-theme').forEach(el => {
        el.addEventListener('click', () => {
            settings.theme = el.dataset.theme;
            saveSettings(settings);
            updateActive();
            applyTheme(settings.theme);
        });
    });

    // Indent buttons
    menu.querySelectorAll('.settings-indent').forEach(el => {
        el.addEventListener('click', () => {
            settings.indentSize = parseInt(el.dataset.size);
            saveSettings(settings);
            updateActive();
            updateAllEditorsIndent(settings.indentSize);
        });
    });
}

main();
