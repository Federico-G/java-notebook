// notebook-model.js — Pure data layer for .ipynb v4 notebooks

let idCounter = 0;
function generateId() {
    return 'cell-' + Date.now().toString(36) + '-' + (idCounter++).toString(36);
}

export function createEmptyNotebook() {
    return {
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {
            kernelspec: { name: 'java', display_name: 'Java', language: 'java' },
            language_info: { name: 'java', version: '21' }
        },
        cells: []
    };
}

export function createCell(type, source = '') {
    return {
        id: generateId(),
        cell_type: type,
        source: source,
        metadata: {}
    };
}

export function fromJSON(obj) {
    if (!obj || obj.nbformat < 4) {
        throw new Error('Unsupported notebook format (requires nbformat >= 4)');
    }
    const notebook = createEmptyNotebook();
    notebook.metadata = obj.metadata || notebook.metadata;
    notebook.cells = (obj.cells || [])
        .filter(c => c.cell_type === 'code' || c.cell_type === 'markdown')
        .map(c => {
            const source = Array.isArray(c.source) ? c.source.join('') : (c.source || '');
            const cell = createCell(c.cell_type, source);
            cell.metadata = c.metadata || {};
            delete cell.metadata.scope; // Strip legacy Global/Local scope
            return cell;
        });
    return notebook;
}

export function toJSON(notebook) {
    const cells = notebook.cells.map(c => {
        const source = splitSource(c.source);
        const cell = {
            id: c.id,
            cell_type: c.cell_type,
            source: source,
            metadata: c.metadata || {}
        };
        if (c.cell_type === 'code') {
            cell.outputs = [];
            cell.execution_count = null;
        }
        return cell;
    });
    return JSON.stringify({
        nbformat: 4,
        nbformat_minor: 5,
        metadata: notebook.metadata,
        cells: cells
    }, null, 1);
}

function splitSource(str) {
    if (!str) return [];
    const lines = str.split('\n');
    return lines.map((line, i) => i < lines.length - 1 ? line + '\n' : line).filter(l => l !== '');
}
