// cell-renderer.js — DOM creation for code & markdown cells

import { marked } from 'marked';

export function renderCodeCell(cell) {
    const el = document.createElement('div');
    el.className = 'cell cell--code';
    el.dataset.cellId = cell.id;

    const scope = cell.metadata.scope || 'local';
    el.innerHTML = `
        <div class="cell-toolbar">
            <button class="btn btn-run" title="Run (Shift+Enter)">&#9654; Run</button>
            <span class="cell-type-badge">Java</span>
            <span class="execution-count"></span>
            <div class="cell-actions">
                <button class="btn btn-sm btn-scope" title="Alternar alcance global/local">${scope === 'global' ? 'Global' : 'Local'}</button>
                <button class="btn btn-sm btn-move-up" title="Subir">&uarr;</button>
                <button class="btn btn-sm btn-move-down" title="Bajar">&darr;</button>
                <button class="btn btn-sm btn-delete" title="Eliminar celda">&times;</button>
            </div>
        </div>
        <div class="cell-editor"></div>
        <div class="cell-output-area" style="display:none">
            <pre class="cell-output"></pre>
        </div>
        <div class="cell-diagnostics" style="display:none"></div>
    `;

    updateExecutionCount(el, cell.execution_count);
    return el;
}

export function renderMarkdownCell(cell) {
    const el = document.createElement('div');
    el.className = 'cell cell--markdown';
    el.dataset.cellId = cell.id;

    el.innerHTML = `
        <div class="cell-toolbar">
            <span class="cell-type-badge">Markdown</span>
            <div class="cell-actions">
                <button class="btn btn-sm btn-md-edit" title="Editar markdown">Editar</button>
                <button class="btn btn-sm btn-md-done" title="Listo" style="display:none">Listo</button>
                <button class="btn btn-sm btn-move-up" title="Subir">&uarr;</button>
                <button class="btn btn-sm btn-move-down" title="Bajar">&darr;</button>
                <button class="btn btn-sm btn-delete" title="Eliminar celda">&times;</button>
            </div>
        </div>
        <div class="cell-editor" style="display:none"></div>
        <div class="cell-rendered-markdown"></div>
    `;

    // Render markdown
    const renderedEl = el.querySelector('.cell-rendered-markdown');
    renderedEl.innerHTML = marked.parse(cell.source || '*Click en Editar para agregar contenido*');

    return el;
}

export function renderAddCellButton() {
    const el = document.createElement('div');
    el.className = 'add-cell-row';
    el.innerHTML = `
        <button class="btn btn-add-code" title="Agregar celda de código">+ Código</button>
        <button class="btn btn-add-markdown" title="Agregar celda markdown">+ Markdown</button>
    `;
    return el;
}

export function updateExecutionCount(cellEl, count) {
    const badge = cellEl.querySelector('.execution-count');
    if (badge) {
        badge.textContent = count != null ? `[${count}]` : '';
    }
}

export function showOutput(cellEl, lines, isError = false) {
    const area = cellEl.querySelector('.cell-output-area');
    const output = cellEl.querySelector('.cell-output');
    if (!area || !output) return;

    if (lines.length === 0) {
        area.style.display = 'none';
        return;
    }
    area.style.display = 'block';
    output.textContent = lines.join('\n');
    if (isError) {
        output.classList.add('error');
    } else {
        output.classList.remove('error');
    }
}

export function appendOutputLine(cellEl, stream, line) {
    const area = cellEl.querySelector('.cell-output-area');
    const output = cellEl.querySelector('.cell-output');
    if (!area || !output) return;
    area.style.display = 'block';

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
    if (area) area.style.display = 'none';
    if (output) {
        output.textContent = '';
        output.classList.remove('error');
    }
    if (diag) {
        diag.style.display = 'none';
        diag.innerHTML = '';
    }
}

export function showDiagnostics(cellEl, diagnostics) {
    const diag = cellEl.querySelector('.cell-diagnostics');
    if (!diag) return;
    if (!diagnostics || diagnostics.length === 0) {
        diag.style.display = 'none';
        return;
    }
    diag.style.display = 'block';
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
    if (running) {
        cellEl.classList.add('running');
        const btn = cellEl.querySelector('.btn-run');
        if (btn) btn.disabled = true;
    } else {
        cellEl.classList.remove('running');
        const btn = cellEl.querySelector('.btn-run');
        if (btn) btn.disabled = false;
    }
}
