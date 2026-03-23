// cell-renderer.js — DOM creation for code & markdown cells

import { marked } from 'marked';

function renderIconButton({ icon, label, variant = 'outline-secondary', size = 'sm', cls = '' }) {
    return `<button class="btn btn-${variant} btn-${size} ${cls}" aria-label="${label}" title="${label}">` +
           `<i class="bi bi-${icon}" aria-hidden="true"></i></button>`;
}

export function renderCodeCell(cell) {
    const el = document.createElement('div');
    el.className = 'card cell cell--code mb-2';
    el.dataset.cellId = cell.id;

    el.innerHTML = `
        <div class="card-header cell-toolbar d-flex align-items-center gap-2 py-1 px-2">
            <button class="btn btn-success btn-sm btn-run" aria-label="Ejecutar" title="Ejecutar (Shift+Enter)">
                <span class="btn-run-label"><i class="bi bi-play-fill" aria-hidden="true"></i><span class="btn-run-text"> Ejecutar</span></span>
                <span class="btn-run-spinner d-none spinner-border spinner-border-sm" role="status"></span>
            </button>
            <span class="badge text-bg-secondary">Java</span>
            <span class="text-body-secondary font-monospace small execution-count"></span>
            <span class="text-body-secondary small execution-time"></span>
            <div class="cell-actions ms-auto d-flex gap-1">
                ${renderIconButton({ icon: 'arrow-up', label: 'Subir', cls: 'btn-move-up' })}
                ${renderIconButton({ icon: 'arrow-down', label: 'Bajar', cls: 'btn-move-down' })}
                ${renderIconButton({ icon: 'x-lg', label: 'Eliminar', variant: 'outline-danger', cls: 'btn-delete' })}
            </div>
        </div>
        <div class="cell-editor"></div>
        <div class="cell-output-area d-none">
            <div class="cell-output-header d-flex justify-content-end gap-1 px-2 pt-1">
                <button class="btn btn-sm py-0 px-1 text-body-secondary btn-copy-output" aria-label="Copiar resultado" title="Copiar resultado">
                    <i class="bi bi-clipboard" aria-hidden="true"></i>
                </button>
                <button class="btn btn-sm py-0 px-1 text-body-secondary btn-clear-output" aria-label="Limpiar resultado" title="Limpiar resultado">
                    <i class="bi bi-x-circle" aria-hidden="true"></i>
                </button>
            </div>
            <pre class="cell-output"></pre>
            <div class="cell-diagnostics"></div>
        </div>
    `;

    updateExecutionCount(el, cell.execution_count);
    return el;
}

export function renderMarkdownCell(cell) {
    const el = document.createElement('div');
    el.className = 'cell cell--markdown mb-2';
    el.dataset.cellId = cell.id;

    el.innerHTML = `
        <div class="cell-toolbar-hover d-flex align-items-center gap-1 py-1 px-2">
            <div class="cell-actions ms-auto d-flex gap-1">
                ${renderIconButton({ icon: 'pencil', label: 'Editar', cls: 'btn-md-edit' })}
                <button class="btn btn-outline-success btn-sm btn-md-done d-none" aria-label="Listo" title="Listo"><i class="bi bi-check-lg" aria-hidden="true"></i></button>
                ${renderIconButton({ icon: 'arrow-up', label: 'Subir', cls: 'btn-move-up' })}
                ${renderIconButton({ icon: 'arrow-down', label: 'Bajar', cls: 'btn-move-down' })}
                ${renderIconButton({ icon: 'x-lg', label: 'Eliminar', variant: 'outline-danger', cls: 'btn-delete' })}
            </div>
        </div>
        <div class="cell-editor d-none"></div>
        <div class="card-body cell-rendered-markdown py-1 px-2"></div>
    `;

    // Render markdown
    const renderedEl = el.querySelector('.cell-rendered-markdown');
    renderedEl.innerHTML = cell.source ? marked.parse(cell.source) : '';

    return el;
}

export function renderAddCellButton() {
    const el = document.createElement('div');
    el.className = 'add-cell-row';
    el.innerHTML = `
        <button class="btn btn-outline-secondary btn-sm btn-add-code" title="Agregar celda de codigo"><i class="bi bi-plus" aria-hidden="true"></i> Codigo</button>
        <button class="btn btn-outline-secondary btn-sm btn-add-markdown" title="Agregar celda markdown"><i class="bi bi-plus" aria-hidden="true"></i> Markdown</button>
    `;
    return el;
}

export function updateExecutionCount(cellEl, count) {
    const badge = cellEl.querySelector('.execution-count');
    if (badge) {
        badge.textContent = count != null ? `[${count}]` : '';
    }
}

export function updateExecutionTime(cellEl, ms) {
    const badge = cellEl.querySelector('.execution-time');
    if (badge) {
        if (ms == null) { badge.textContent = ''; return; }
        badge.textContent = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
    }
}


export function appendOutputLine(cellEl, stream, line) {
    const area = cellEl.querySelector('.cell-output-area');
    const output = cellEl.querySelector('.cell-output');
    if (!area || !output) return;
    area.classList.remove('d-none');

    const span = document.createElement('span');
    span.textContent = line + '\n';
    if (stream === 'stderr') {
        span.className = 'stderr';
    }
    output.appendChild(span);
}

export function clearOutput(cellEl) {
    const area = cellEl.querySelector('.cell-output-area');
    const output = cellEl.querySelector('.cell-output');
    const diag = cellEl.querySelector('.cell-diagnostics');
    if (area) area.classList.add('d-none');
    if (output) {
        output.textContent = '';
        output.classList.remove('error');
    }
    if (diag) diag.innerHTML = '';
}

export function showDiagnostics(cellEl, diagnostics) {
    const area = cellEl.querySelector('.cell-output-area');
    const diag = cellEl.querySelector('.cell-diagnostics');
    if (!diag) return;
    if (!diagnostics || diagnostics.length === 0) {
        diag.innerHTML = '';
        return;
    }
    // Show the output area so diagnostics are visible
    if (area) area.classList.remove('d-none');
    diag.innerHTML = diagnostics.map(d => {
        const severity = d.severity === 'ERROR' ? 'error' : 'warning';
        const line = d.lineNumber ? `Linea ${d.lineNumber}: ` : '';
        return `<div class="diagnostic diagnostic--${severity}">${line}${escapeHtml(d.message)}</div>`;
    }).join('');
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function setCellRunning(cellEl, running) {
    const label = cellEl.querySelector('.btn-run-label');
    const spinner = cellEl.querySelector('.btn-run-spinner');
    const btn = cellEl.querySelector('.btn-run');
    if (running) {
        cellEl.classList.add('running');
        label?.classList.add('d-none');
        spinner?.classList.remove('d-none');
        if (btn) btn.disabled = true;
    } else {
        cellEl.classList.remove('running');
        label?.classList.remove('d-none');
        spinner?.classList.add('d-none');
        if (btn) btn.disabled = false;
    }
}
