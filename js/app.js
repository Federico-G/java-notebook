// app.js — Main application bootstrap

import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import { Modal } from 'bootstrap';
import { createEmptyNotebook, createCell, fromJSON } from './notebook-model.js';
import { initJShell, setProgressCallback } from './jshell-proxy.js';
import { updateAllEditorsIndent, updateAllEditorsTheme } from './editor-setup.js';
import {
    importFromFile, exportToFile, setupDragDrop,
    saveAllTabsToStorage, loadTabsFromStorage
} from './ipynb-io.js';
import {
    initTabManager, createTab, switchTab, getActiveTab, getAllTabs, getActiveTabId,
    updateTabFilename
} from './tab-manager.js';
import {
    focusFirstCodeCell, focusAdjacentCell, undoDelete,
    copySelectedCell, cutSelectedCell, pasteCellAfterSelected,
    deleteSelectedCell
} from './cell-manager.js';

// DOM elements
const container = document.getElementById('notebook-container');
const tabActionsBar = document.getElementById('tab-actions-bar');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingStatus = document.getElementById('loading-status');
const loadingImport = document.getElementById('loading-import');
const btnImport = document.getElementById('btn-import');
const btnExport = document.getElementById('btn-export');

// --- Multi-tab: delegate ?url= to existing tab ---

const channel = new BroadcastChannel('java-notebook');

async function tryDelegateURL() {
    const url = new URLSearchParams(window.location.search).get('url');
    if (!url) return false;

    return new Promise(resolve => {
        const onMessage = (e) => {
            if (e.data?.type === 'ack-import') {
                channel.removeEventListener('message', onMessage);
                resolve(true);
            }
        };
        channel.addEventListener('message', onMessage);
        channel.postMessage({ type: 'import-url', url });
        setTimeout(() => {
            channel.removeEventListener('message', onMessage);
            resolve(false);
        }, 500);
    });
}

function showDelegatedMessage() {
    loadingOverlay.querySelector('.spinner-border')?.remove();
    loadingStatus.remove();
    loadingImport.textContent = 'Notebook enviado a la pestaña abierta';
    loadingImport.classList.remove('d-none');
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-outline-secondary mt-3';
    btn.textContent = 'Cerrar pestaña';
    btn.addEventListener('click', () => window.close());
    loadingImport.after(btn);
}

let autosaveTimer = null;

async function main() {
    // If ?url= and another tab is open, delegate and stop
    if (await tryDelegateURL()) {
        showDelegatedMessage();
        return;
    }

    // Restore read mode before rendering
    initReadMode();

    // Init tab manager
    initTabManager(container, tabActionsBar, onNotebookChanged, newNotebook);

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

    // Import notebook from ?url= query parameter
    await importFromURL();

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

    // Listen for ?url= delegated from other tabs
    channel.addEventListener('message', async (e) => {
        if (e.data?.type !== 'import-url') return;
        const url = e.data.url;
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const obj = await resp.json();
            const nb = fromJSON(obj);
            const filename = url.split('/').pop().split('?')[0] || 'notebook.ipynb';
            createTab(nb, filename);
            channel.postMessage({ type: 'ack-import' });
        } catch (err) {
            console.error('Error importing delegated URL:', err);
        }
    });

    // Init JShell (CheerpJ + JShellBridge)
    setProgressCallback(updateLoadingStatus);
    try {
        await initJShell();
        loadingOverlay.classList.add('d-none');
        focusFirstCodeCell();
    } catch (e) {
        loadingStatus.textContent = 'Error al inicializar Java: ' + e.message;
        loadingStatus.classList.add('error');
        console.error('JShell init failed:', e);
    }
}

function updateLoadingStatus(phase) {
    switch (phase) {
        case 'loading-cheerpj':
            loadingStatus.textContent = 'Cargando entorno Java (CheerpJ)...';
            break;
        case 'loading-jshell':
            loadingStatus.textContent = 'Cargando JShell...';
            break;
        case 'warming-up':
            loadingStatus.textContent = 'Preparando compilador...';
            break;
        case 'ready':
            loadingStatus.textContent = 'Listo!';
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

// --- Import from URL ---

async function importFromURL() {
    const url = new URLSearchParams(window.location.search).get('url');
    if (!url) return;
    const filename = url.split('/').pop().split('?')[0] || 'notebook.ipynb';
    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const obj = await resp.json();
        const nb = fromJSON(obj);
        createTab(nb, filename);
        loadingImport.textContent = 'Notebook importado: ' + filename;
        loadingImport.classList.remove('d-none');
        // Clean the URL without reloading
        window.history.replaceState({}, '', window.location.pathname);
    } catch (e) {
        loadingImport.textContent = 'Error al importar: ' + e.message;
        loadingImport.classList.remove('d-none');
        console.error('Error importing from URL:', e);
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
        menu.querySelectorAll('.settings-shortcuts').forEach(el => {
            el.classList.toggle('active', (el.dataset.enabled === 'true') === !!settings.shortcuts);
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

    // Shortcuts toggle
    menu.querySelectorAll('.settings-shortcuts').forEach(el => {
        el.addEventListener('click', () => {
            settings.shortcuts = el.dataset.enabled === 'true';
            saveSettings(settings);
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
    if (settings.readMode !== false) {
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

// Always-on: work even inside editors (blocked only by modals/dropdowns)
const ALWAYS_SHORTCUTS = [
    { key: 's', handler: () => handleExport() },
    { key: 'ArrowUp', handler: () => focusAdjacentCell(-1) },
    { key: 'ArrowDown', handler: () => focusAdjacentCell(1) },
    { key: 'e', handler: () => toggleReadMode() },
];

// Idle-only: require focus outside editor + shortcuts setting enabled
const IDLE_SHORTCUTS = [
    { key: 'z', handler: () => undoDelete() },
    { key: 'x', handler: () => cutSelectedCell() },
    { key: 'c', handler: () => copySelectedCell() },
    { key: 'v', handler: () => pasteCellAfterSelected() },
    { key: 'Delete', handler: () => deleteSelectedCell() },
];

function hasOverlayOpen() {
    return !!document.querySelector('.modal.show') || !!document.querySelector('.dropdown-menu.show');
}

function isOutsideEditor() {
    const el = document.activeElement;
    return !(el?.closest('.cm-editor') || el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA');
}

function initGlobalShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        if (hasOverlayOpen()) return;

        const always = ALWAYS_SHORTCUTS.find(s => s.key === e.key);
        if (always) {
            e.preventDefault();
            always.handler();
            return;
        }

        if (!isOutsideEditor()) return;
        if (!getSettings().shortcuts) return;
        // Don't intercept copy/cut when user has text selected (e.g. in output area)
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0 && (e.key === 'c' || e.key === 'x')) return;
        const idle = IDLE_SHORTCUTS.find(s => s.key === e.key);
        if (idle) {
            e.preventDefault();
            idle.handler();
        }
    });
}

main();
