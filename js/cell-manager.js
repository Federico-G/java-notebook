// cell-manager.js — Bridges the notebook model and DOM, handles cell lifecycle

import { createCell } from './notebook-model.js';
import { createJavaEditor, createMarkdownEditor, formatEditor } from './editor-setup.js';
import {
    renderCodeCell, renderMarkdownCell, renderAddCellButton,
    clearOutput, appendOutputLine, showDiagnostics,
    setCellRunning, updateExecutionCount, updateExecutionTime
} from './cell-renderer.js';
import { buildSyntheticClass, mapLineToCell, CELL_MARKER_PREFIX } from './synthetic-class.js';
import { compile, isReady } from './compiler-worker-proxy.js';
import { marked } from 'marked';

let notebook = null;
let containerEl = null;
let executionMgr = null;
let cellStates = new Map(); // cellId -> { editorView, el, exitMarkdownEdit? }
let executionCounter = 0;
let onNotebookChanged = null;
let activeMarkdownCellId = null;
let selectedCellId = null;
let lastDeleted = null; // { cell, index } for single-level undo
let cellClipboard = null; // { cell_type, source, metadata } — global across tabs

function selectCell(cellId) {
    if (selectedCellId === cellId) return;
    containerEl.querySelectorAll('.cell--selected').forEach(el => el.classList.remove('cell--selected'));
    selectedCellId = cellId;
    if (cellId && !document.body.classList.contains('read-mode')) {
        const el = containerEl.querySelector(`.cell[data-cell-id="${cellId}"]`);
        if (el) el.classList.add('cell--selected');
    }
}

export function addCellAfterSelected(type) {
    syncAllEditors();
    let idx = notebook.cells.length;
    if (selectedCellId) {
        const selIdx = getCellIndex(selectedCellId);
        if (selIdx >= 0) idx = selIdx + 1;
    }
    addCell(idx, type);
}

function closeActiveMarkdownEditor() {
    if (activeMarkdownCellId) {
        const state = cellStates.get(activeMarkdownCellId);
        if (state && state.exitMarkdownEdit) {
            state.exitMarkdownEdit();
        }
        activeMarkdownCellId = null;
    }
}

export function init(notebookRef, container, execManager, onChange) {
    notebook = notebookRef;
    containerEl = container;
    executionMgr = execManager;
    onNotebookChanged = onChange;
    if (notebook) renderAll();

    // Toggle selection highlight when read mode changes
    window.addEventListener('readmode-changed', ({ detail }) => {
        if (detail.active) {
            containerEl.querySelectorAll('.cell--selected').forEach(el => el.classList.remove('cell--selected'));
        } else if (selectedCellId) {
            const el = containerEl.querySelector(`.cell[data-cell-id="${selectedCellId}"]`);
            if (el) el.classList.add('cell--selected');
        }
    });

    // Click outside a markdown editor closes it (mousedown fires before CodeMirror swallows the click)
    document.addEventListener('mousedown', (e) => {
        if (!activeMarkdownCellId) return;
        const state = cellStates.get(activeMarkdownCellId);
        if (state && state.el && !state.el.contains(e.target)) {
            closeActiveMarkdownEditor();
        }
    });
}

export function setNotebook(newNotebook) {
    // Destroy existing editors
    for (const [, state] of cellStates) {
        if (state.editorView) state.editorView.destroy();
    }
    cellStates.clear();
    notebook = newNotebook;
    executionCounter = 0;
    renderAll();
}

export function getNotebook() {
    syncAllEditors();
    return notebook;
}

function syncAllEditors() {
    for (const cell of notebook.cells) {
        const state = cellStates.get(cell.id);
        if (state && state.editorView) {
            cell.source = state.editorView.state.doc.toString();
        }
    }
}

function notifyChanged() {
    if (onNotebookChanged) onNotebookChanged();
}

function getCellIndex(cellId) {
    return notebook.cells.findIndex(c => c.id === cellId);
}

function bindBtn(el, selector, handler) {
    el.querySelector(selector)?.addEventListener('click', handler);
}

function renderAll() {
    // Destroy any remaining editors not already cleaned up
    for (const [, state] of cellStates) {
        if (state.editorView) state.editorView.destroy();
    }
    cellStates.clear();
    activeMarkdownCellId = null;

    containerEl.innerHTML = '';

    for (let i = 0; i < notebook.cells.length; i++) {
        const addBtn = renderAddCellButton();
        bindAddButtons(addBtn);
        containerEl.appendChild(addBtn);

        const cell = notebook.cells[i];
        const el = renderCellElement(cell);
        containerEl.appendChild(el);
    }

    // Final add button
    const addBtn = renderAddCellButton();
    bindAddButtons(addBtn);
    containerEl.appendChild(addBtn);

    // Re-apply or auto-select
    if (!selectedCellId && notebook.cells.length > 0) {
        selectedCellId = notebook.cells[0].id;
    }
    if (selectedCellId) {
        const el = containerEl.querySelector(`.cell[data-cell-id="${selectedCellId}"]`);
        if (el) el.classList.add('cell--selected');
    }

    updateAddRowVisibility();
}

function updateAddRowVisibility() {
    const addRows = containerEl.querySelectorAll('.add-cell-row');
    addRows.forEach((row, i) => {
        row.classList.toggle('add-cell-row--visible', i === 0 || i === addRows.length - 1);
    });
}

function scrollToCell(cellId) {
    const el = containerEl.querySelector(`.cell[data-cell-id="${cellId}"]`);
    if (el) {
        const containerRect = containerEl.getBoundingClientRect();
        const cellRect = el.getBoundingClientRect();
        if (cellRect.top < containerRect.top || cellRect.bottom > containerRect.bottom) {
            el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        }
    }
}

function renderCellElement(cell) {
    let el;
    if (cell.cell_type === 'code') {
        el = renderCodeCell(cell);
        const editorContainer = el.querySelector('.cell-editor');
        const editorView = createJavaEditor(editorContainer, cell.source, {
            onRun: () => runCell(cell.id).then(() => {
                // Focus next editor since keyboard is already active
                const i = getCellIndex(cell.id);
                if (i >= 0 && i + 1 < notebook.cells.length) {
                    const ns = cellStates.get(notebook.cells[i + 1].id);
                    if (ns?.editorView) ns.editorView.focus();
                }
            }),
            onRunStay: () => runCell(cell.id, false),
            onChange: () => notifyChanged()
        });
        cellStates.set(cell.id, { editorView, el });
        bindCellButtons(el, cell);
    } else {
        el = renderMarkdownCell(cell);
        const editorContainer = el.querySelector('.cell-editor');
        const renderedEl = el.querySelector('.cell-rendered-markdown');
        const editBtn = el.querySelector('.btn-md-edit');
        const doneBtn = el.querySelector('.btn-md-done');
        let editorView = null;

        // Keep a mutable ref object so enterEditMode/exitEditMode always see current state
        const mdState = { editorView: null, el, exitMarkdownEdit: null };
        cellStates.set(cell.id, mdState);

        function enterEditMode() {
            closeActiveMarkdownEditor();

            if (!mdState.editorView) {
                editorView = createMarkdownEditor(editorContainer, cell.source, {
                    onRun: () => exitEditMode(),
                    onRunAdvance: () => {
                        exitEditMode();
                        const idx = getCellIndex(cell.id);
                        if (idx >= 0 && idx + 1 < notebook.cells.length) {
                            const next = notebook.cells[idx + 1];
                            const nextState = cellStates.get(next.id);
                            if (nextState?.editorView) nextState.editorView.focus();
                            selectCell(next.id);
                        }
                    },
                    onChange: () => notifyChanged()
                });
                mdState.editorView = editorView;
            } else {
                editorView = mdState.editorView;
                editorView.dispatch({
                    changes: { from: 0, to: editorView.state.doc.length, insert: cell.source }
                });
            }
            editorContainer.classList.remove('d-none');
            renderedEl.classList.add('d-none');
            editBtn.classList.add('d-none');
            doneBtn.classList.remove('d-none');
            el.classList.add('editing');
            activeMarkdownCellId = cell.id;
            // Focus moves to editor, pencil button loses focus
            editorView.focus();
        }

        function exitEditMode() {
            if (mdState.editorView) {
                cell.source = mdState.editorView.state.doc.toString();
            }
            renderedEl.innerHTML = cell.source ? marked.parse(cell.source) : '';
            editorContainer.classList.add('d-none');
            renderedEl.classList.remove('d-none');
            editBtn.classList.remove('d-none');
            doneBtn.classList.add('d-none');
            el.classList.remove('editing');
            if (activeMarkdownCellId === cell.id) activeMarkdownCellId = null;
            document.activeElement?.blur();
            notifyChanged();
        }

        mdState.exitMarkdownEdit = exitEditMode;

        editBtn.addEventListener('click', enterEditMode);
        doneBtn.addEventListener('click', exitEditMode);
        renderedEl.addEventListener('dblclick', enterEditMode);
        bindCellButtons(el, cell);
    }

    // Click/focus selects this cell
    el.addEventListener('mousedown', () => selectCell(cell.id));
    el.addEventListener('focusin', () => selectCell(cell.id));

    return el;
}

function bindAddButtons(addBtnEl) {
    function getIndex() {
        // Count how many .cell elements appear before this add-row in the DOM
        let count = 0;
        let sibling = addBtnEl.previousElementSibling;
        while (sibling) {
            if (sibling.classList.contains('cell')) count++;
            sibling = sibling.previousElementSibling;
        }
        return count;
    }
    addBtnEl.querySelector('.btn-add-code').addEventListener('click', () => {
        addCell(getIndex(), 'code');
    });
    addBtnEl.querySelector('.btn-add-markdown').addEventListener('click', () => {
        addCell(getIndex(), 'markdown');
    });
}

function bindCellButtons(el, cell) {
    bindBtn(el, '.btn-run', () => runCell(cell.id));
    bindBtn(el, '.btn-delete', () => deleteCell(cell.id));
    bindBtn(el, '.btn-move-up', () => moveCell(cell.id, -1));
    bindBtn(el, '.btn-move-down', () => moveCell(cell.id, 1));
    bindBtn(el, '.btn-clear-output', () => clearOutput(el));
    bindBtn(el, '.btn-copy-output', () => {
        const output = el.querySelector('.cell-output')?.innerText || '';
        const diag = el.querySelector('.cell-diagnostics')?.innerText || '';
        const text = [output, diag].filter(Boolean).join('\n');
        if (text) navigator.clipboard.writeText(text);
    });

    const scopeBtn = el.querySelector('.btn-scope');
    if (scopeBtn) {
        const applyScopeStyle = () => {
            const isLocal = (cell.metadata.scope || 'local') === 'local';
            el.classList.toggle('cell--local', isLocal);
            el.classList.toggle('cell--global', !isLocal);
            scopeBtn.classList.toggle('btn-outline-warning', isLocal);
            scopeBtn.classList.toggle('btn-outline-success', !isLocal);
        };
        scopeBtn.addEventListener('click', () => {
            const isGlobal = (cell.metadata.scope || 'local') === 'global';
            cell.metadata.scope = isGlobal ? 'local' : 'global';
            scopeBtn.textContent = cell.metadata.scope === 'global' ? 'Global' : 'Local';
            applyScopeStyle();
            notifyChanged();
        });
        applyScopeStyle();
    }
}

function addCell(index, type, existingCell = null) {
    document.activeElement?.blur();
    syncAllEditors();
    const cell = existingCell || createCell(type, '');
    notebook.cells.splice(index, 0, cell);

    // Build new DOM elements
    const newAddRow = renderAddCellButton();
    bindAddButtons(newAddRow);
    const newCellEl = renderCellElement(cell);

    // DOM structure: addRow0 cell0 addRow1 cell1 ... addRowN
    // Insert new cell + its trailing add-row AFTER the add-row at position `index`.
    // The existing add-row becomes the one before the new cell,
    // and the new add-row goes after the new cell.
    const addRows = containerEl.querySelectorAll('.add-cell-row');
    const refAddRow = addRows[index];
    // Insert: refAddRow [newCellEl] [newAddRow] ...rest
    const afterRef = refAddRow.nextSibling;
    containerEl.insertBefore(newCellEl, afterRef);
    containerEl.insertBefore(newAddRow, afterRef);

    selectCell(cell.id);
    updateAddRowVisibility();
    scrollToCell(cell.id);
    notifyChanged();

    const state = cellStates.get(cell.id);
    if (state && state.editorView) state.editorView.focus();
}

function deleteCell(cellId) {
    const idx = getCellIndex(cellId);
    if (idx === -1) return;

    // Save for undo — sync source before destroying editor
    const cell = notebook.cells[idx];
    const state = cellStates.get(cellId);
    if (state?.editorView) cell.source = state.editorView.state.doc.toString();
    lastDeleted = { cell: { ...cell, metadata: { ...cell.metadata } }, index: idx };

    if (state?.editorView) state.editorView.destroy();
    cellStates.delete(cellId);

    // Remove the cell element and its preceding add-row from the DOM
    const cellEl = containerEl.querySelector(`.cell[data-cell-id="${cellId}"]`);
    const prevAddRow = cellEl?.previousElementSibling;
    if (prevAddRow?.classList.contains('add-cell-row')) prevAddRow.remove();
    cellEl?.remove();

    notebook.cells.splice(idx, 1);
    const nextIdx = Math.min(idx, notebook.cells.length - 1);
    const nextId = nextIdx >= 0 ? notebook.cells[nextIdx].id : null;
    selectedCellId = null; // clear so selectCell doesn't bail
    if (nextId) selectCell(nextId);

    updateAddRowVisibility();
    notifyChanged();
}

function moveCell(cellId, direction) {
    syncAllEditors();
    const idx = getCellIndex(cellId);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= notebook.cells.length) return;

    // Update model
    const [cell] = notebook.cells.splice(idx, 1);
    notebook.cells.splice(newIdx, 0, cell);

    // DOM: addRow0 CELL0 addRow1 CELL1 addRow2 ...
    // Swap the two adjacent cell elements; the add-rows stay in place.
    const cellEl = containerEl.querySelector(`.cell[data-cell-id="${cellId}"]`);
    const otherId = notebook.cells[idx]?.id; // the cell now at our old index
    const otherEl = otherId ? containerEl.querySelector(`.cell[data-cell-id="${otherId}"]`) : null;

    if (cellEl && otherEl) {
        // Use a placeholder to swap without losing position
        const placeholder = document.createComment('');
        containerEl.insertBefore(placeholder, cellEl);
        containerEl.insertBefore(cellEl, otherEl);
        containerEl.insertBefore(otherEl, placeholder);
        placeholder.remove();
    }

    scrollToCell(cellId);
    notifyChanged();
}

export async function runCell(cellId, advanceFocus = true) {
    if (!isReady()) {
        alert('El compilador aun esta cargando. Por favor espera.');
        return;
    }
    syncAllEditors();
    const idx = getCellIndex(cellId);
    if (idx === -1) return;
    const cell = notebook.cells[idx];
    if (cell.cell_type !== 'code') return;

    const state = cellStates.get(cellId);
    if (!state) return;

    // Clear previous output
    clearOutput(state.el);
    setCellRunning(state.el, true);
    updateExecutionTime(state.el, null);

    // Local cells run completely independently; global cells include all globals before them
    const isLocal = (cell.metadata.scope || 'local') === 'local';
    const codeCells = isLocal
        ? [cell]
        : notebook.cells.slice(0, idx + 1).filter(c =>
            c.cell_type === 'code' && (c.id === cellId || (c.metadata.scope || 'local') === 'global')
        );
    const sources = codeCells.map(c => {
        const cs = cellStates.get(c.id);
        return cs && cs.editorView ? cs.editorView.state.doc.toString() : c.source;
    });

    // Build synthetic class
    const javaSource = buildSyntheticClass(sources);

    try {
        // Compile
        const result = await compile(javaSource);

        if (!result.success || !result.script) {
            // Map diagnostics back to cells
            const mappedDiags = (result.diagnostics || []).map(d => {
                const mapped = mapLineToCell(d.lineNumber, sources);
                return {
                    ...d,
                    lineNumber: mapped ? mapped.lineInCell : d.lineNumber,
                    cellIndex: mapped ? mapped.cellIndex : null
                };
            });

            // Show diagnostics on the relevant cells
            const cellDiags = mappedDiags.filter(d => d.cellIndex === codeCells.length - 1 || d.cellIndex === null);
            showDiagnostics(state.el, cellDiags);

            // Also show diagnostics on other cells if applicable
            for (const d of mappedDiags) {
                if (d.cellIndex !== null && d.cellIndex !== codeCells.length - 1) {
                    const otherCell = codeCells[d.cellIndex];
                    const otherState = cellStates.get(otherCell.id);
                    if (otherState) showDiagnostics(otherState.el, [d]);
                }
            }

            setCellRunning(state.el, false);
            return;
        }

        // Execute the compiled WASM — only show output from the current cell
        const targetCellIndex = codeCells.length - 1;
        let currentCellIndex = -1;
        let sawMarker = false;

        const execStartTime = performance.now();
        const execResult = await executionMgr.execute(
            result.script,
            (stream, line) => {
                if (stream === 'stdout' && line.startsWith(CELL_MARKER_PREFIX)) {
                    currentCellIndex = parseInt(line.slice(CELL_MARKER_PREFIX.length), 10);
                    sawMarker = true;
                    return;
                }
                // If markers are working, filter by cell; otherwise show everything
                if (!sawMarker || currentCellIndex === targetCellIndex) {
                    appendOutputLine(state.el, stream, line);
                }
            }
        );

        if (execResult.error) {
            appendOutputLine(state.el, 'stderr', execResult.error);
        }

        executionCounter++;
        updateExecutionCount(state.el, executionCounter);
        updateExecutionTime(state.el, Math.round(performance.now() - execStartTime));
    } catch (e) {
        appendOutputLine(state.el, 'stderr', 'Error: ' + e.message);
    }

    setCellRunning(state.el, false);
    notifyChanged();

    // Advance selection to next cell (without focusing editor to avoid mobile keyboard)
    if (advanceFocus && idx + 1 < notebook.cells.length) {
        const nextCell = notebook.cells[idx + 1];
        selectCell(nextCell.id);
        scrollToCell(nextCell.id);
    }
}

export async function runAll() {
    syncAllEditors();
    const codeCells = notebook.cells.filter(c => c.cell_type === 'code');
    for (const cell of codeCells) {
        await runCell(cell.id, false);
    }
}


export function clearAllOutputs() {
    for (const cell of notebook.cells) {
        if (cell.cell_type !== 'code') continue;
        const state = cellStates.get(cell.id);
        if (state) clearOutput(state.el);
    }
}

export function moveSelectedCell(direction) {
    if (!selectedCellId) return;
    moveCell(selectedCellId, direction);
}

export function deleteSelectedCell() {
    if (!selectedCellId) return;
    deleteCell(selectedCellId);
}

export function focusFirstCodeCell() {
    const first = notebook?.cells.find(c => c.cell_type === 'code');
    if (first) {
        const state = cellStates.get(first.id);
        if (state?.editorView) state.editorView.focus();
        selectCell(first.id);
    }
}

export function focusAdjacentCell(direction) {
    if (!selectedCellId) return;
    const idx = getCellIndex(selectedCellId);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= notebook.cells.length) return;

    // Blur current editor
    const current = cellStates.get(selectedCellId);
    if (current?.editorView) current.editorView.contentDOM.blur();

    const next = notebook.cells[newIdx];
    const nextState = cellStates.get(next.id);
    if (nextState?.editorView) nextState.editorView.focus();
    selectCell(next.id);
    scrollToCell(next.id);
}

export function undoDelete() {
    if (!lastDeleted) return false;
    const { cell, index } = lastDeleted;
    lastDeleted = null;
    // Give it a fresh id to avoid conflicts
    cell.id = 'cell-' + Date.now().toString(36) + '-undo';
    addCell(Math.min(index, notebook.cells.length), cell.cell_type, cell);
    return true;
}

export function hasUndoDelete() { return lastDeleted !== null; }

export function getLastDeleted() { return lastDeleted; }
export function setLastDeleted(val) { lastDeleted = val; }

export function copySelectedCell() {
    if (!selectedCellId) return false;
    syncAllEditors();
    const cell = notebook.cells.find(c => c.id === selectedCellId);
    if (!cell) return false;
    cellClipboard = {
        cell_type: cell.cell_type,
        source: cell.source,
        metadata: { ...cell.metadata }
    };
    return true;
}

export function cutSelectedCell() {
    if (!copySelectedCell()) return false;
    deleteCell(selectedCellId);
    return true;
}

export function pasteCellAfterSelected() {
    if (!cellClipboard) return false;
    syncAllEditors();
    let idx = notebook.cells.length;
    if (selectedCellId) {
        const selIdx = getCellIndex(selectedCellId);
        if (selIdx >= 0) idx = selIdx + 1;
    }
    const cell = createCell(cellClipboard.cell_type, cellClipboard.source);
    cell.metadata = { ...cellClipboard.metadata };
    addCell(idx, cell.cell_type, cell);
    return true;
}

export function hasCellClipboard() { return cellClipboard !== null; }

export function getExecutionCounter() { return executionCounter; }
export function setExecutionCounter(n) { executionCounter = n; }
