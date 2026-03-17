// cell-manager.js — Bridges the notebook model and DOM, handles cell lifecycle

import { createCell } from './notebook-model.js';
import { createJavaEditor, createMarkdownEditor, formatEditor } from './editor-setup.js';
import {
    renderCodeCell, renderMarkdownCell, renderAddCellButton,
    clearOutput, appendOutputLine, showDiagnostics,
    setCellRunning, updateExecutionCount
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

function selectCell(cellId) {
    if (selectedCellId === cellId) return;
    // Deselect all, then select target (avoids stale references)
    containerEl.querySelectorAll('.cell--selected').forEach(el => el.classList.remove('cell--selected'));
    selectedCellId = cellId;
    if (cellId) {
        const el = containerEl.querySelector(`.cell[data-cell-id="${cellId}"]`);
        if (el) el.classList.add('cell--selected');
    }
}

export function addCellAfterSelected(type) {
    syncAllEditors();
    let idx = notebook.cells.length; // default: end
    if (selectedCellId) {
        const selIdx = notebook.cells.findIndex(c => c.id === selectedCellId);
        if (selIdx >= 0) idx = selIdx + 1;
    }
    const cell = createCell(type, '');
    notebook.cells.splice(idx, 0, cell);
    renderAll();
    selectCell(cell.id);
    notifyChanged();
    const state = cellStates.get(cell.id);
    if (state && state.editorView) state.editorView.focus();
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

function renderActionBar() {
    const bar = document.getElementById('notebook-actions');
    if (!bar) return;
    bar.innerHTML = `
        <button class="btn btn-add-code-top">+ Código</button>
        <button class="btn btn-add-md-top">+ Markdown</button>
        <div class="toolbar-spacer"></div>
        <button class="btn btn-primary btn-run-all">&#9654; Run All</button>
    `;
    bar.querySelector('.btn-run-all').addEventListener('click', () => runAll());
    bar.querySelector('.btn-add-code-top').addEventListener('click', () => addCellAfterSelected('code'));
    bar.querySelector('.btn-add-md-top').addEventListener('click', () => addCellAfterSelected('markdown'));
}

function renderAll() {
    containerEl.innerHTML = '';
    renderActionBar();

    for (let i = 0; i < notebook.cells.length; i++) {
        const addBtn = renderAddCellButton();
        bindAddButtons(addBtn, i);
        containerEl.appendChild(addBtn);

        const cell = notebook.cells[i];
        const el = renderCellElement(cell);
        containerEl.appendChild(el);
    }

    // Final add button
    const addBtn = renderAddCellButton();
    bindAddButtons(addBtn, notebook.cells.length);
    containerEl.appendChild(addBtn);

    // Re-apply or auto-select
    if (!selectedCellId && notebook.cells.length > 0) {
        selectedCellId = notebook.cells[0].id;
    }
    if (selectedCellId) {
        const el = containerEl.querySelector(`.cell[data-cell-id="${selectedCellId}"]`);
        if (el) el.classList.add('cell--selected');
    }
}

function renderCellElement(cell) {
    let el;
    if (cell.cell_type === 'code') {
        el = renderCodeCell(cell);
        const editorContainer = el.querySelector('.cell-editor');
        const editorView = createJavaEditor(editorContainer, cell.source, {
            onRun: () => runCell(cell.id),
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
                    onChange: () => notifyChanged()
                });
                mdState.editorView = editorView;
            } else {
                editorView = mdState.editorView;
                editorView.dispatch({
                    changes: { from: 0, to: editorView.state.doc.length, insert: cell.source }
                });
            }
            editorContainer.style.display = 'block';
            renderedEl.style.display = 'none';
            editBtn.style.display = 'none';
            doneBtn.style.display = '';
            activeMarkdownCellId = cell.id;
            editorView.focus();
        }

        function exitEditMode() {
            if (mdState.editorView) {
                cell.source = mdState.editorView.state.doc.toString();
            }
            renderedEl.innerHTML = marked.parse(cell.source || '*Click en Editar para agregar contenido*');
            editorContainer.style.display = 'none';
            renderedEl.style.display = 'block';
            editBtn.style.display = '';
            doneBtn.style.display = 'none';
            if (activeMarkdownCellId === cell.id) activeMarkdownCellId = null;
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

function bindAddButtons(addBtnEl, index) {
    addBtnEl.querySelector('.btn-add-code').addEventListener('click', () => {
        addCell(index, 'code');
    });
    addBtnEl.querySelector('.btn-add-markdown').addEventListener('click', () => {
        addCell(index, 'markdown');
    });
}

function bindCellButtons(el, cell) {
    const runBtn = el.querySelector('.btn-run');
    if (runBtn) runBtn.addEventListener('click', () => runCell(cell.id));

    el.querySelector('.btn-delete')?.addEventListener('click', () => deleteCell(cell.id));
    el.querySelector('.btn-move-up')?.addEventListener('click', () => moveCell(cell.id, -1));
    el.querySelector('.btn-move-down')?.addEventListener('click', () => moveCell(cell.id, 1));

    const scopeBtn = el.querySelector('.btn-scope');
    if (scopeBtn) {
        scopeBtn.addEventListener('click', () => {
            const isGlobal = (cell.metadata.scope || 'local') === 'global';
            cell.metadata.scope = isGlobal ? 'local' : 'global';
            scopeBtn.textContent = cell.metadata.scope === 'global' ? 'Global' : 'Local';
            el.classList.toggle('cell--local', cell.metadata.scope === 'local');
            notifyChanged();
        });
        el.classList.toggle('cell--local', (cell.metadata.scope || 'local') === 'local');
    }
}

function addCell(index, type) {
    syncAllEditors();
    const cell = createCell(type, type === 'code' ? '' : '');
    notebook.cells.splice(index, 0, cell);
    renderAll();
    notifyChanged();

    // Focus the new cell's editor
    const state = cellStates.get(cell.id);
    if (state && state.editorView) {
        state.editorView.focus();
    }
}

function deleteCell(cellId) {
    const idx = notebook.cells.findIndex(c => c.id === cellId);
    if (idx === -1) return;

    const state = cellStates.get(cellId);
    if (state && state.editorView) state.editorView.destroy();
    cellStates.delete(cellId);

    notebook.cells.splice(idx, 1);
    const nextIdx = Math.min(idx, notebook.cells.length - 1);
    selectedCellId = nextIdx >= 0 ? notebook.cells[nextIdx].id : null;
    renderAll();
    notifyChanged();
}

function moveCell(cellId, direction) {
    syncAllEditors();
    const idx = notebook.cells.findIndex(c => c.id === cellId);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= notebook.cells.length) return;

    const [cell] = notebook.cells.splice(idx, 1);
    notebook.cells.splice(newIdx, 0, cell);
    renderAll();
    notifyChanged();
}

export async function runCell(cellId, advanceFocus = true) {
    if (!isReady()) {
        alert('El compilador aun esta cargando. Por favor espera.');
        return;
    }
    syncAllEditors();
    const idx = notebook.cells.findIndex(c => c.id === cellId);
    if (idx === -1) return;
    const cell = notebook.cells[idx];
    if (cell.cell_type !== 'code') return;

    const state = cellStates.get(cellId);
    if (!state) return;

    // Clear previous output
    clearOutput(state.el);
    setCellRunning(state.el, true);

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
    } catch (e) {
        appendOutputLine(state.el, 'stderr', 'Error: ' + e.message);
    }

    setCellRunning(state.el, false);
    notifyChanged();

    // Advance focus to next cell
    if (advanceFocus && idx + 1 < notebook.cells.length) {
        const nextCell = notebook.cells[idx + 1];
        const nextState = cellStates.get(nextCell.id);
        if (nextState && nextState.editorView) {
            nextState.editorView.focus();
        }
    }
}

export async function runAll() {
    syncAllEditors();
    const codeCells = notebook.cells.filter(c => c.cell_type === 'code');
    for (const cell of codeCells) {
        await runCell(cell.id, false);
    }
}

export function getExecutionCounter() { return executionCounter; }
export function setExecutionCounter(n) { executionCounter = n; }
