// tab-manager.js — Multi-tab notebook state management

import { init as initCellManager, setNotebook, getNotebook, runAll,
         getExecutionCounter, setExecutionCounter } from './cell-manager.js';

let tabs = [];
let activeTabId = null;
let containerEl = null;
let tabBarEl = null;
let execManager = null;
let onChangeCallback = null;
let onNewTab = null;
let idCounter = 0;

function genTabId() {
    return 'tab-' + Date.now().toString(36) + '-' + (idCounter++).toString(36);
}

export function initTabManager(container, tabBar, execMgr, onChange, onNew) {
    containerEl = container;
    tabBarEl = tabBar;
    execManager = execMgr;
    onChangeCallback = onChange;
    onNewTab = onNew;
    initCellManager(null, container, execMgr, () => {
        onChangeCallback();
    });
}

export function createTab(notebook, filename) {
    // Save current tab state first
    if (activeTabId) saveActiveTabState();

    const tab = {
        id: genTabId(),
        filename: filename || 'notebook.ipynb',
        notebook: notebook,
        executionCounter: 0,
        scrollTop: 0
    };
    tabs.push(tab);
    activeTabId = tab.id;

    setExecutionCounter(0);
    setNotebook(notebook);
    renderTabBar();
    onChangeCallback();
    return tab.id;
}

export function switchTab(tabId) {
    if (tabId === activeTabId) return;
    const target = tabs.find(t => t.id === tabId);
    if (!target) return;

    saveActiveTabState();

    activeTabId = tabId;
    setExecutionCounter(target.executionCounter);
    setNotebook(target.notebook);
    containerEl.scrollTop = target.scrollTop;
    renderTabBar();
    onChangeCallback();
}

export function closeTab(tabId) {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (tabs.length === 1) return; // don't close the last tab

    if (!confirm(`Cerrar "${displayName(tab.filename)}"?`)) return;

    const idx = tabs.indexOf(tab);
    tabs.splice(idx, 1);

    if (activeTabId === tabId) {
        // Switch to nearest tab
        const newIdx = Math.min(idx, tabs.length - 1);
        activeTabId = tabs[newIdx].id;
        const target = tabs[newIdx];
        setExecutionCounter(target.executionCounter);
        setNotebook(target.notebook);
        containerEl.scrollTop = target.scrollTop;
    }
    renderTabBar();
    onChangeCallback();
}

export function getActiveTab() {
    saveActiveTabState();
    return tabs.find(t => t.id === activeTabId) || null;
}

export function getAllTabs() {
    saveActiveTabState();
    return tabs;
}

export function getActiveTabId() {
    return activeTabId;
}

export function updateTabFilename(tabId, filename) {
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
        tab.filename = filename;
        renderTabBar();
    }
}

function saveActiveTabState() {
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab) return;
    tab.notebook = getNotebook();
    tab.executionCounter = getExecutionCounter();
    tab.scrollTop = containerEl.scrollTop;
}

function renderTabBar() {
    tabBarEl.innerHTML = '';
    for (const tab of tabs) {
        const el = document.createElement('div');
        el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
        el.innerHTML = `
            <span class="tab-name">${escapeHtml(displayName(tab.filename))}</span>
            ${tabs.length > 1 ? '<button class="tab-close" title="Cerrar pestaña">&times;</button>' : ''}
        `;
        const nameSpan = el.querySelector('.tab-name');
        el.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab-close')) {
                closeTab(tab.id);
            } else {
                switchTab(tab.id);
            }
        });
        nameSpan.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const input = document.createElement('input');
            input.className = 'tab-name-input';
            input.value = displayName(tab.filename);
            input.size = Math.max(input.value.length, 8);
            nameSpan.replaceWith(input);
            input.focus();
            input.select();

            const finish = () => {
                const val = input.value.trim() || displayName(tab.filename);
                tab.filename = val + '.ipynb';
                renderTabBar();
                onChangeCallback();
            };
            input.addEventListener('blur', finish);
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') input.blur();
                if (ev.key === 'Escape') { input.value = displayName(tab.filename); input.blur(); }
            });
        });
        tabBarEl.appendChild(el);
    }

    // "+" button at the end
    const addBtn = document.createElement('button');
    addBtn.className = 'tab-add';
    addBtn.title = 'Nuevo notebook';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', () => {
        if (onNewTab) onNewTab();
    });
    tabBarEl.appendChild(addBtn);
}

function displayName(filename) {
    return filename.replace(/\.ipynb$/, '');
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
