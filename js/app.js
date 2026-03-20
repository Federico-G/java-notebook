// app.js — Main application bootstrap

import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import { Modal } from 'bootstrap';
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
import { focusFirstCodeCell, focusAdjacentCell, undoDelete } from './cell-manager.js';

// DOM elements
const container = document.getElementById('notebook-container');
const tabActionsBar = document.getElementById('tab-actions-bar');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingStatus = document.getElementById('loading-status');
const btnImport = document.getElementById('btn-import');
const btnExport = document.getElementById('btn-export');

// Execution manager (shared across all tabs)
const execManager = new ExecutionManager();

let autosaveTimer = null;

async function main() {
    // Restore read mode before rendering
    initReadMode();

    // Init tab manager
    initTabManager(container, tabActionsBar, execManager, onNotebookChanged, newNotebook);

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

    // Init examples dropdown + settings + shortcuts
    initExamples();
    initSettings();
    initShortcutsModal();
    initHelpButton();
    initGlobalShortcuts();

    // Init compiler
    setProgressCallback(updateLoadingStatus);
    try {
        await initCompiler();
        loadingOverlay.classList.add('d-none');
        focusFirstCodeCell();
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
    const archivoMenu = document.getElementById('archivo-menu');
    const divider = document.getElementById('examples-divider');
    const header = document.getElementById('examples-header');
    if (!archivoMenu) return;

    try {
        const resp = await fetch('examples/index.json');
        if (!resp.ok) {
            divider?.remove();
            header?.remove();
            return;
        }
        const examples = await resp.json();
        for (const ex of examples) {
            const li = document.createElement('li');
            const item = document.createElement('button');
            item.className = 'dropdown-item';
            item.textContent = ex.name;
            item.addEventListener('click', async () => {
                try {
                    const r = await fetch('examples/' + ex.filename);
                    const obj = await r.json();
                    const nb = fromJSON(obj);
                    createTab(nb, ex.filename);
                } catch (err) {
                    alert('Error al cargar ejemplo: ' + err.message);
                }
            });
            li.appendChild(item);
            archivoMenu.appendChild(li);
        }
    } catch (e) {
        divider?.remove();
        header?.remove();
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
    document.documentElement.dataset.bsTheme = isDark ? 'dark' : 'light';
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
    const menu = document.getElementById('settings-menu');
    if (!menu) return;

    const settings = getSettings();

    function updateActive() {
        menu.querySelectorAll('.settings-indent').forEach(el => {
            el.classList.toggle('active', String(settings.indentSize || 4) === el.dataset.size);
        });
        menu.querySelectorAll('.settings-theme').forEach(el => {
            el.classList.toggle('active', (settings.theme || 'system') === el.dataset.theme);
        });
        const isReadMode = document.body.classList.contains('read-mode');
        menu.querySelectorAll('.settings-mode').forEach(el => {
            el.classList.toggle('active', el.dataset.mode === (isReadMode ? 'read' : 'edit'));
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

    // Mode buttons
    menu.querySelectorAll('.settings-mode').forEach(el => {
        el.addEventListener('click', () => {
            const wantRead = el.dataset.mode === 'read';
            const isRead = document.body.classList.contains('read-mode');
            if (wantRead !== isRead) toggleReadMode();
            updateActive();
        });
    });

    // Sync when toggled via shortcut
    window.addEventListener('readmode-changed', updateActive);
}

// --- Keyboard Shortcuts Modal ---

function initShortcutsModal() {
    const modalEl = document.getElementById('shortcuts-modal');
    if (!modalEl) return;
    const modal = new Modal(modalEl);
    document.addEventListener('keydown', (e) => {
        const el = document.activeElement;
        if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' ||
            el?.closest('.cm-editor') || el?.isContentEditable) return;
        if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) {
            e.preventDefault();
            modal.toggle();
        }
    });
}

// --- Read Mode ---

export function toggleReadMode() {
    const settings = getSettings();
    const active = !document.body.classList.contains('read-mode');
    document.body.classList.toggle('read-mode', active);
    settings.readMode = active;
    saveSettings(settings);
    // Notify any listeners (tab-manager re-renders the toggle icon)
    window.dispatchEvent(new CustomEvent('readmode-changed', { detail: { active } }));
}

function initReadMode() {
    const settings = getSettings();
    if (settings.readMode) {
        document.body.classList.add('read-mode');
    }
}

function initHelpButton() {
    const btn = document.getElementById('btn-help');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const modalEl = document.getElementById('shortcuts-modal');
        if (modalEl) Modal.getOrCreateInstance(modalEl).toggle();
    });
}

const GLOBAL_SHORTCUTS = [
    { key: 's', handler: () => handleExport() },
    { key: 'ArrowUp', handler: () => focusAdjacentCell(-1) },
    { key: 'ArrowDown', handler: () => focusAdjacentCell(1) },
    { key: 'e', handler: () => toggleReadMode() },
    { key: 'z', outsideEditor: true, handler: () => undoDelete() },
];

function initGlobalShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const shortcut = GLOBAL_SHORTCUTS.find(s => s.key === e.key);
        if (!shortcut) return;
        if (shortcut.outsideEditor) {
            const el = document.activeElement;
            if (el?.closest('.cm-editor') || el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA') return;
        }
        e.preventDefault();
        shortcut.handler();
    });
}

main();
