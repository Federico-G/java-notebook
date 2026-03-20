// tab-manager.js — Multi-tab notebook state management

import {
    init as initCellManager, setNotebook, getNotebook, runAll,
    addCellAfterSelected, clearAllOutputs,
    moveSelectedCell, deleteSelectedCell, undoDelete, hasUndoDelete,
    getExecutionCounter, setExecutionCounter
} from './cell-manager.js';


let tabs = [];
let activeTabId = null;
let containerEl = null;
let barEl = null;
let execManager = null;
let onChangeCallback = null;
let onNewTab = null;
let idCounter = 0;

function genTabId() {
    return 'tab-' + Date.now().toString(36) + '-' + (idCounter++).toString(36);
}

export function initTabManager(container, bar, execMgr, onChange, onNew) {
    containerEl = container;
    barEl = bar;
    execManager = execMgr;
    onChangeCallback = onChange;
    onNewTab = onNew;
    initCellManager(null, container, execMgr, () => {
        onChangeCallback();
    });
}

export function createTab(notebook, filename) {
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
    renderBar();
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

    // Just toggle active class — no full rebuild needed
    barEl.querySelectorAll('.nav-link[data-tab-id]').forEach(link => {
        link.classList.toggle('active', link.dataset.tabId === tabId);
    });

    onChangeCallback();
}

export function closeTab(tabId) {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (tabs.length === 1) return;

    if (!confirm(`Cerrar "${displayName(tab.filename)}"?`)) return;

    const idx = tabs.indexOf(tab);
    tabs.splice(idx, 1);

    if (activeTabId === tabId) {
        const newIdx = Math.min(idx, tabs.length - 1);
        activeTabId = tabs[newIdx].id;
        const target = tabs[newIdx];
        setExecutionCounter(target.executionCounter);
        setNotebook(target.notebook);
        containerEl.scrollTop = target.scrollTop;
    }
    renderBar();
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
        renderBar();
    }
}

function saveActiveTabState() {
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab) return;
    tab.notebook = getNotebook();
    tab.executionCounter = getExecutionCounter();
    tab.scrollTop = containerEl.scrollTop;
}

function renderBar() {
    barEl.innerHTML = '';

    const row = document.createElement('div');
    row.className = 'container-xxl d-flex align-items-end';

    // --- Tab list ---
    const tabList = document.createElement('ul');
    tabList.className = 'nav nav-tabs flex-nowrap flex-grow-1 border-0 tab-list';

    for (const tab of tabs) {
        const li = document.createElement('li');
        li.className = 'nav-item';

        const navLink = document.createElement('button');
        navLink.className = 'nav-link' + (tab.id === activeTabId ? ' active' : '');
        navLink.dataset.tabId = tab.id;

        const name = displayName(tab.filename);
        const hasClose = tabs.length > 1;
        navLink.title = tab.filename;
        navLink.innerHTML = `<span class="tab-name">${escapeHtml(name)}</span>` +
            (hasClose ? '<span class="tab-close" role="button" aria-label="Cerrar">&times;</span>' : '');
        if (hasClose) navLink.style.paddingRight = '4px';

        navLink.addEventListener('click', (e) => {
            if (e.target.closest('.tab-close')) {
                closeTab(tab.id);
                return;
            }
            switchTab(tab.id);
        });

        // Middle-click to close
        navLink.addEventListener('mousedown', (e) => {
            if (e.button === 1 && tabs.length > 1) {
                e.preventDefault();
                closeTab(tab.id);
            }
        });

        function startRename() {
            const nameSpan = navLink.querySelector('.tab-name');
            if (!nameSpan) return;
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
                renderBar();
                onChangeCallback();
            };
            input.addEventListener('blur', finish);
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') input.blur();
                if (ev.key === 'Escape') { input.value = displayName(tab.filename); input.blur(); }
            });
        }

        // Double-click to rename (desktop)
        navLink.querySelector('.tab-name')?.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            startRename();
        });

        // Long-press to rename (mobile)
        let longPressTimer = null;
        navLink.addEventListener('touchstart', (e) => {
            longPressTimer = setTimeout(() => {
                e.preventDefault();
                startRename();
            }, 500);
        }, { passive: false });
        navLink.addEventListener('touchend', () => clearTimeout(longPressTimer));
        navLink.addEventListener('touchmove', () => clearTimeout(longPressTimer));

        li.appendChild(navLink);
        tabList.appendChild(li);
    }

    // Wrap tab list in a container for scroll arrows
    const tabContainer = document.createElement('div');
    tabContainer.className = 'tab-scroll-container';

    const arrowLeft = document.createElement('button');
    arrowLeft.className = 'tab-scroll-arrow tab-scroll-left';
    arrowLeft.innerHTML = '<i class="bi bi-chevron-left" aria-hidden="true"></i>';
    arrowLeft.setAttribute('aria-label', 'Scroll tabs left');
    arrowLeft.addEventListener('click', () => { tabList.scrollBy({ left: -120, behavior: 'smooth' }); });

    const arrowRight = document.createElement('button');
    arrowRight.className = 'tab-scroll-arrow tab-scroll-right';
    arrowRight.innerHTML = '<i class="bi bi-chevron-right" aria-hidden="true"></i>';
    arrowRight.setAttribute('aria-label', 'Scroll tabs right');
    arrowRight.addEventListener('click', () => { tabList.scrollBy({ left: 120, behavior: 'smooth' }); });

    tabContainer.appendChild(arrowLeft);
    tabContainer.appendChild(tabList);
    tabContainer.appendChild(arrowRight);
    row.appendChild(tabContainer);

    function updateArrows() {
        const overflows = tabList.scrollWidth > tabList.clientWidth + 1;
        const atStart = tabList.scrollLeft <= 0;
        const atEnd = tabList.scrollLeft + tabList.clientWidth >= tabList.scrollWidth - 1;
        // Desktop arrows
        arrowLeft.classList.toggle('d-none', !overflows || atStart);
        arrowRight.classList.toggle('d-none', !overflows || atEnd);
        // Mobile fade hints
        tabContainer.classList.toggle('has-overflow', overflows);
        tabContainer.classList.toggle('scrolled-start', atStart);
        tabContainer.classList.toggle('scrolled-end', atEnd);
    }
    tabList.addEventListener('scroll', updateArrows);
    // Defer so layout is computed
    requestAnimationFrame(updateArrows);

    // "+" new tab — outside scroll, hugs the last tab
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-sm text-body-secondary flex-shrink-0 align-self-stretch tab-actions-btn';
    addBtn.title = 'Nuevo notebook';
    addBtn.innerHTML = '<i class="bi bi-plus-lg" aria-hidden="true"></i>';
    addBtn.addEventListener('click', () => { if (onNewTab) onNewTab(); });
    row.appendChild(addBtn);

    // Spacer pushes menu to the right
    const spacer = document.createElement('div');
    spacer.className = 'flex-grow-1';
    row.appendChild(spacer);

    // --- Notebook menu (right side) ---
    const menuContainer = document.createElement('div');
    menuContainer.className = 'dropdown flex-shrink-0 ps-1 align-self-stretch d-flex';

    menuContainer.innerHTML = `
        <button class="btn btn-sm align-self-stretch tab-actions-btn" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Menu">
            <i class="bi bi-three-dots-vertical" aria-hidden="true"></i>
        </button>
        <ul class="dropdown-menu dropdown-menu-end">
            <li class="dropdown-header">Ejecutar</li>
            <li><button class="dropdown-item action-run-all"><i class="bi bi-play-circle"></i> Ejecutar todos</button></li>
            <li><button class="dropdown-item action-clear-all-output"><i class="bi bi-eraser"></i> Limpiar resultados</button></li>
            <li><hr class="dropdown-divider"></li>
            <li class="dropdown-header">Celdas</li>
            <li><button class="dropdown-item action-add-code"><i class="bi bi-plus"></i> Codigo</button></li>
            <li><button class="dropdown-item action-add-md"><i class="bi bi-plus"></i> Markdown</button></li>
            <li><hr class="dropdown-divider"></li>
            <li class="dropdown-header">Celda seleccionada</li>
            <li><button class="dropdown-item action-move-up"><i class="bi bi-arrow-up"></i> Subir celda</button></li>
            <li><button class="dropdown-item action-move-down"><i class="bi bi-arrow-down"></i> Bajar celda</button></li>
            <li><button class="dropdown-item text-danger action-delete-cell"><i class="bi bi-trash"></i> Eliminar celda</button></li>
            <li><button class="dropdown-item action-undo-delete" disabled><i class="bi bi-arrow-counterclockwise"></i> Deshacer eliminar</button></li>
        </ul>
    `;

    menuContainer.querySelector('.action-add-code').addEventListener('click', () => addCellAfterSelected('code'));
    menuContainer.querySelector('.action-add-md').addEventListener('click', () => addCellAfterSelected('markdown'));
    menuContainer.querySelector('.action-run-all').addEventListener('click', () => runAll());
    menuContainer.querySelector('.action-clear-all-output').addEventListener('click', () => clearAllOutputs());
    menuContainer.querySelector('.action-move-up').addEventListener('click', () => moveSelectedCell(-1));
    menuContainer.querySelector('.action-move-down').addEventListener('click', () => moveSelectedCell(1));
    menuContainer.querySelector('.action-delete-cell').addEventListener('click', () => deleteSelectedCell());

    const undoBtn = menuContainer.querySelector('.action-undo-delete');
    undoBtn.addEventListener('click', () => { undoDelete(); undoBtn.disabled = true; });

    // Update disabled state each time dropdown opens
    menuContainer.addEventListener('show.bs.dropdown', () => {
        undoBtn.disabled = !hasUndoDelete();
    });

    row.appendChild(menuContainer);
    barEl.appendChild(row);

    // Auto-scroll active tab into view
    const activeLink = tabList.querySelector('.nav-link.active');
    if (activeLink) activeLink.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
}

function displayName(filename) {
    return filename.replace(/\.ipynb$/, '');
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
