// editor-setup.js — CodeMirror 6 factory for Java and Markdown editors

import { basicSetup, EditorView } from 'codemirror';
import { java } from '@codemirror/lang-java';
import { keymap } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { indentSelection, indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { search } from '@codemirror/search';

function getIndentSize() {
    try {
        const s = JSON.parse(localStorage.getItem('java-notebook-settings'));
        return s && s.indentSize || 4;
    } catch { return 4; }
}

// Track all live editors and their indent compartments so we can reconfigure them
const liveEditors = new Set();

const baseTheme = EditorView.theme({
    '&': { fontSize: '14px' },
    '.cm-content': { fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace" },
    '.cm-gutters': { fontSize: '12px' },
    '.cm-scroller': { overflow: 'auto' }
});

function makeIndentExtensions(compartment, size) {
    return compartment.of([
        indentUnit.of(' '.repeat(size)),
        EditorState.tabSize.of(size)
    ]);
}

export function createJavaEditor(parentEl, initialDoc, callbacks) {
    const runKeymap = keymap.of([
        {
            key: 'Shift-Enter',
            run: () => { if (callbacks.onRun) callbacks.onRun(); return true; }
        },
        {
            key: 'Ctrl-Enter',
            run: () => { if (callbacks.onRunStay) callbacks.onRunStay(); return true; }
        },
        {
            key: 'Ctrl-Shift-f',
            run: (view) => { formatEditor(view); return true; }
        }
    ]);

    const updateListener = EditorView.updateListener.of(update => {
        if (update.docChanged && callbacks.onChange) {
            callbacks.onChange(update.state.doc.toString());
        }
    });

    const indentCompartment = new Compartment();
    const indent = getIndentSize();
    const state = EditorState.create({
        doc: initialDoc || '',
        extensions: [
            runKeymap,
            keymap.of([indentWithTab]),
            basicSetup,
            search({ top: true }),
            java(),
            makeIndentExtensions(indentCompartment, indent),
            updateListener,
            EditorView.lineWrapping,
            baseTheme
        ]
    });

    const view = new EditorView({ state, parent: parentEl });
    liveEditors.add({ view, indentCompartment });
    return view;
}

export function formatEditor(view) {
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    indentSelection(view);
    const pos = view.state.selection.main.head;
    view.dispatch({ selection: { anchor: pos } });
}

export function createMarkdownEditor(parentEl, initialDoc, callbacks) {
    const updateListener = EditorView.updateListener.of(update => {
        if (update.docChanged && callbacks.onChange) {
            callbacks.onChange(update.state.doc.toString());
        }
    });

    const exitKeymap = keymap.of([
        {
            key: 'Shift-Enter',
            run: () => { if (callbacks.onRun) callbacks.onRun(); return true; }
        },
        {
            key: 'Ctrl-Enter',
            run: () => { if (callbacks.onRun) callbacks.onRun(); return true; }
        },
        {
            key: 'Escape',
            run: () => { if (callbacks.onRun) callbacks.onRun(); return true; }
        }
    ]);

    const indentCompartment = new Compartment();
    const indent = getIndentSize();
    const state = EditorState.create({
        doc: initialDoc || '',
        extensions: [
            exitKeymap,
            keymap.of([indentWithTab]),
            basicSetup,
            search({ top: true }),
            makeIndentExtensions(indentCompartment, indent),
            updateListener,
            EditorView.lineWrapping,
            baseTheme
        ]
    });

    const view = new EditorView({ state, parent: parentEl });
    liveEditors.add({ view, indentCompartment });
    return view;
}

// Reconfigure all live editors with a new indent size
export function updateAllEditorsIndent(size) {
    for (const entry of liveEditors) {
        // Check if the editor is still in the DOM
        if (!entry.view.dom.isConnected) {
            liveEditors.delete(entry);
            continue;
        }
        entry.view.dispatch({
            effects: entry.indentCompartment.reconfigure([
                indentUnit.of(' '.repeat(size)),
                EditorState.tabSize.of(size)
            ])
        });
    }
}
