// ipynb-io.js — Import/export/drag-drop .ipynb files

import { fromJSON, toJSON } from './notebook-model.js';

export function importFromFile() {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.ipynb';
        input.addEventListener('change', async () => {
            if (!input.files || input.files.length === 0) {
                resolve(null);
                return;
            }
            try {
                const text = await input.files[0].text();
                const obj = JSON.parse(text);
                const notebook = fromJSON(obj);
                resolve({ notebook, filename: input.files[0].name });
            } catch (e) {
                reject(new Error('Failed to import notebook: ' + e.message));
            }
        });
        input.click();
    });
}

export function exportToFile(notebook, filename = 'notebook.ipynb') {
    const json = toJSON(notebook);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function setupDragDrop(containerEl, onImport) {
    containerEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        containerEl.classList.add('drag-over');
    });

    containerEl.addEventListener('dragleave', (e) => {
        e.preventDefault();
        containerEl.classList.remove('drag-over');
    });

    containerEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        containerEl.classList.remove('drag-over');

        const file = [...e.dataTransfer.files].find(f => f.name.endsWith('.ipynb'));
        if (!file) return;

        try {
            const text = await file.text();
            const obj = JSON.parse(text);
            const notebook = fromJSON(obj);
            onImport({ notebook, filename: file.name });
        } catch (err) {
            console.error('Drop import failed:', err);
        }
    });
}

// Autosave/restore from localStorage (multi-tab)
const STORAGE_KEY = 'java-notebook-autosave';

export function saveAllTabsToStorage(tabs, activeTabId) {
    try {
        const data = {
            version: 2,
            activeTabId,
            tabs: tabs.map(t => ({
                id: t.id,
                filename: t.filename,
                notebook: JSON.parse(toJSON(t.notebook))
            }))
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        // localStorage might be full or unavailable
    }
}

export function loadTabsFromStorage() {
    try {
        const json = localStorage.getItem(STORAGE_KEY);
        if (!json) return null;
        const data = JSON.parse(json);

        // v2 multi-tab format
        if (data.version === 2 && Array.isArray(data.tabs)) {
            return {
                activeTabId: data.activeTabId,
                tabs: data.tabs.map(t => ({
                    id: t.id,
                    filename: t.filename,
                    notebook: fromJSON(t.notebook)
                }))
            };
        }

        // v1 migration: raw notebook object
        if (data.nbformat) {
            return {
                activeTabId: null,
                tabs: [{ id: null, filename: 'notebook.ipynb', notebook: fromJSON(data) }]
            };
        }

        return null;
    } catch (e) {
        return null;
    }
}
