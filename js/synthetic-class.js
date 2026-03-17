// synthetic-class.js — Wraps notebook cell snippets into a compilable Java class

const IMPORT_REGEX = /^\s*import\s+[\w.*]+\s*;\s*$/;

// Marker printed between cells so we can filter output per-cell
export const CELL_MARKER_PREFIX = '@@NBCELL@@';

export function buildSyntheticClass(cellSources) {
    const imports = new Set();
    const bodyLines = [];

    // Default imports
    imports.add('import java.util.*;');
    imports.add('import java.io.*;');

    for (let i = 0; i < cellSources.length; i++) {
        // Emit marker before each cell's code
        bodyLines.push(`System.out.println("@@NBCELL@@${i}");`);
        const lines = cellSources[i].split('\n');
        for (const line of lines) {
            if (IMPORT_REGEX.test(line)) {
                imports.add(line.trim());
            } else {
                bodyLines.push(line);
            }
        }
    }

    const importBlock = [...imports].join('\n');
    const body = bodyLines.join('\n');

    return `${importBlock}

public class Main {
    public static void main(String[] args) throws Exception {
${indent(body, 8)}
    }
}
`;
}

function indent(text, spaces) {
    const pad = ' '.repeat(spaces);
    return text.split('\n').map(line => line.trim() === '' ? '' : pad + line).join('\n');
}

// Map compiler diagnostics line numbers back to cell/line.
// Returns { cellIndex, lineInCell } or null.
export function mapLineToCell(line, cellSources) {
    // The generated class has:
    // - imports (variable lines)
    // - 1 blank line
    // - "public class Main {"
    // - "    public static void main(String[] args) throws Exception {"
    // Then cell code starts.

    const imports = new Set();
    imports.add('import java.util.*;');
    imports.add('import java.io.*;');
    for (const source of cellSources) {
        for (const l of source.split('\n')) {
            if (IMPORT_REGEX.test(l)) imports.add(l.trim());
        }
    }

    // Header: imports + blank line + class decl + main decl = imports.size + 3
    const headerLines = imports.size + 3;
    const codeLine = line - headerLines;
    if (codeLine < 1) return null;

    let currentLine = 0;
    for (let i = 0; i < cellSources.length; i++) {
        const sourceLines = cellSources[i].split('\n').filter(l => !IMPORT_REGEX.test(l));
        const cellLineCount = sourceLines.length + 1; // +1 for blank separator
        if (codeLine <= currentLine + cellLineCount) {
            return { cellIndex: i, lineInCell: codeLine - currentLine };
        }
        currentLine += cellLineCount;
    }
    return null;
}
