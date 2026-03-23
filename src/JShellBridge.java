import jdk.jshell.*;
import java.io.*;
import java.util.*;

/**
 * JShellBridge — Multi-session bridge between JavaScript and JShell in CheerpJ.
 *
 * Designed for CheerpJ's library mode (cheerpjRunLibrary). Supports multiple
 * concurrent JShell sessions (one per notebook tab) via a session map.
 * JS calls init(sessionId) to create a session, eval(sessionId, code) to run
 * code, reset(sessionId) to clear state, and close(sessionId) to destroy it.
 *
 * CheerpJ-specific workarounds:
 *   - SnippetEvent.value() always returns null — not usable
 *   - shell.varValue() returns type defaults (0, null, false) — not usable
 *   - Printing via shell.eval("println($N)") works for reading values, but re-evaluates
 *     the expression for temp vars — causes double side effects for ++/--
 *   - Exceptions from LocalExecutionControl are silently swallowed — expressions like
 *     1/0 return 0 instead of throwing. Workaround: wrap expressions in try/catch
 *     before eval so exception handling is in the compiled bytecode.
 *   - CheerpJ routes stdout to a #console DOM element, not to Java PrintStream objects.
 *     The SwitchOutputStream captures output to a buffer when 'capturing' is true,
 *     but actual JShell snippet output goes to the DOM. JS reads both sources.
 */
public class JShellBridge {

    // --- Per-session state ---

    static class SessionState {
        JShell shell;
        SourceCodeAnalysis sca;
        int scratchCounter;
    }

    private static final Map<String, SessionState> sessions = new HashMap<>();

    // --- Shared output capture state (only one eval runs at a time) ---

    static PrintStream realOut;
    static boolean capturing = false;
    static ByteArrayOutputStream outputBuffer = new ByteArrayOutputStream();

    /**
     * Switchable output stream. When capturing=true, writes to outputBuffer.
     * Otherwise forwards to the original System.out (realOut).
     *
     * Uses ByteArrayOutputStream (not StringBuilder) so multi-byte UTF-8
     * characters (tildes, accents, etc.) are preserved correctly.
     *
     * Named static class (not anonymous) to avoid generating JShellBridge$1.class —
     * each extra .class file must be separately loaded via cheerpOSAddStringFile.
     */
    static class SwitchOutputStream extends OutputStream {
        public void write(int b) {
            if (capturing) outputBuffer.write(b);
            else if (realOut != null) realOut.write(b);
        }
        public void write(byte[] b, int off, int len) {
            if (capturing) {
                outputBuffer.write(b, off, len);
            } else if (realOut != null) realOut.write(b, off, len);
        }
        public void flush() { if (realOut != null) realOut.flush(); }
    }

    private static final PrintStream switchStream = new PrintStream(new SwitchOutputStream());

    /** Write a string to outputBuffer as UTF-8 bytes */
    private static void bufferWrite(String s) {
        try { outputBuffer.write(s.getBytes("UTF-8")); } catch (Exception e) { /* ignore */ }
    }
    private static boolean outputRedirected = false;

    /**
     * Initialize a new JShell session with local execution engine.
     * Must be called once per session before eval(). Sets up stdout/stderr
     * capture (shared) and creates a JShell instance for this session.
     */
    public static String init(String sessionId) {
        try {
            if (!outputRedirected) {
                realOut = System.out;
                System.setOut(switchStream);
                System.setErr(switchStream);
                outputRedirected = true;
            }
            SessionState state = new SessionState();
            state.shell = JShell.builder()
                .executionEngine("local")
                .out(switchStream)
                .err(switchStream)
                .build();
            state.sca = state.shell.sourceCodeAnalysis();
            state.scratchCounter = 0;
            initFormatter(state.shell);
            sessions.put(sessionId, state);
            return "OK";
        } catch (Throwable t) {
            return "ERROR: " + t.toString();
        }
    }

    /** Define __fmt helper in JShell — formats values like real JShell output */
    private static void initFormatter(JShell shell) {
        shell.eval(
            "String __fmt(Object v) { "
            + "if (v == null) return \"null\"; "
            + "if (v instanceof String) return \"\\\"\" + v + \"\\\"\"; "
            + "if (v instanceof Character) return \"'\" + v + \"'\"; "
            + "if (v.getClass().isArray()) { "
            + "  int len = java.lang.reflect.Array.getLength(v); "
            + "  String type = v.getClass().getSimpleName().replaceFirst(\"\\\\[\\\\]\", \"[\" + len + \"]\"); "
            + "  var sb = new StringBuilder(type + \" { \"); "
            + "  for (int i = 0; i < len; i++) { "
            + "    if (i > 0) sb.append(\", \"); "
            + "    sb.append(__fmt(java.lang.reflect.Array.get(v, i))); "
            + "  } "
            + "  return sb.append(\" }\").toString(); "
            + "} "
            + "return String.valueOf(v); }"
        );
    }

    /**
     * Evaluate user input in a specific session. Handles multi-statement input
     * by splitting with SourceCodeAnalysis. Each snippet goes through a 3-tier
     * eval strategy:
     *
     *   1. throw statements → wrapped in try/catch
     *   2. expressions → wrapped in try { var __r = (expr); println(__r); } catch { ... }
     *   3. declarations/statements → normal evalOneSnippet
     *
     * Returns: output string, or "@@ERR@@..." for errors.
     */
    public static String eval(String sessionId, String cellCode) {
        SessionState state = sessions.get(sessionId);
        if (state == null) return "ERROR: Session not initialized: " + sessionId;
        try {
            outputBuffer.reset();
            capturing = true;
            StringBuilder errors = new StringBuilder();

            String processed = preprocessMultiline(state.sca, cellCode);

            String remaining = processed;
            while (remaining != null && !remaining.trim().isEmpty()) {
                SourceCodeAnalysis.CompletionInfo ci = state.sca.analyzeCompletion(remaining);
                SourceCodeAnalysis.Completeness comp = ci.completeness();

                if (comp == SourceCodeAnalysis.Completeness.EMPTY) break;

                if (comp == SourceCodeAnalysis.Completeness.COMPLETE
                    || comp == SourceCodeAnalysis.Completeness.COMPLETE_WITH_SEMI
                    || comp == SourceCodeAnalysis.Completeness.CONSIDERED_INCOMPLETE) {

                    String src = ci.source();
                    String srcTrimmed = src.trim().replaceAll(";$", "").trim();

                    // Tier 1: throw statements — wrap in try/catch
                    if (srcTrimmed.startsWith("throw ")) {
                        state.shell.eval("try { " + src + " } catch (Throwable __e) { "
                            + "System.out.println(\"Exception \" + __e.getClass().getSimpleName() "
                            + "+ \": \" + __e.getMessage()); }");
                    }
                    // Tier 2: try as expression with try/catch value capture
                    else if (!tryEvalAsExpression(state, srcTrimmed, errors)) {
                        // Tier 3: not an expression — declarations, statements, control flow
                        evalOneSnippet(state, src, errors);
                    }

                    remaining = ci.remaining();
                } else {
                    errors.append("Incomplete input: ").append(remaining.trim()).append('\n');
                    break;
                }
            }

            capturing = false;
            switchStream.flush();
            String output = outputBuffer.toString("UTF-8");
            if (errors.length() > 0) {
                StringBuilder combined = new StringBuilder();
                for (String line : errors.toString().trim().split("\n")) {
                    combined.append("@@ERR@@").append(line).append("\n");
                }
                if (!output.isEmpty()) combined.append(output);
                return combined.toString().trim();
            }
            return output;
        } catch (Throwable t) {
            capturing = false;
            return "ERROR: " + t.toString();
        }
    }

    /**
     * Pre-process multiline input: use SourceCodeAnalysis to determine where each
     * snippet ends and add semicolons where needed.
     */
    private static String preprocessMultiline(SourceCodeAnalysis sca, String input) {
        if (!input.contains("\n")) return input;

        String[] lines = input.split("\n");
        StringBuilder result = new StringBuilder();
        StringBuilder buffer = new StringBuilder();

        for (String line : lines) {
            if (buffer.length() > 0) buffer.append("\n");
            buffer.append(line);

            SourceCodeAnalysis.CompletionInfo ci = sca.analyzeCompletion(buffer.toString());
            SourceCodeAnalysis.Completeness comp = ci.completeness();

            if (comp == SourceCodeAnalysis.Completeness.COMPLETE) {
                String buf = buffer.toString().trim();
                boolean isBlockDecl = buf.matches("(?s)^(class|interface|enum|record|abstract|void|public|private|protected|static|default|synchronized)\\b.*")
                    || buf.matches("(?s)^[a-zA-Z_$][\\w$]*\\s*(<.*>)?\\s+[a-zA-Z_$][\\w$]*\\s*\\(.*");
                if (buf.endsWith(";") || isBlockDecl) {
                    result.append(buffer).append("\n");
                } else {
                    result.append(buffer).append(";\n");
                }
                buffer.setLength(0);
            } else if (comp == SourceCodeAnalysis.Completeness.COMPLETE_WITH_SEMI) {
                result.append(buffer).append(";\n");
                buffer.setLength(0);
            }
        }

        if (buffer.length() > 0) {
            result.append(buffer);
        }

        return result.toString();
    }

    private static boolean tryEvalAsExpression(SessionState state, String expr, StringBuilder errors) {
        state.scratchCounter++;
        String displayName;
        String varName = "__s" + state.scratchCounter;
        boolean isBareIdentifier = expr.matches("[a-zA-Z_$][a-zA-Z0-9_$]*")
            && !expr.equals("true") && !expr.equals("false") && !expr.equals("null");
        boolean isAssignment = expr.matches("[a-zA-Z_$][a-zA-Z0-9_$]*\\s*[+\\-*/%&|^]?=(?!=).*");
        if (isBareIdentifier) {
            displayName = expr;
        } else if (isAssignment) {
            displayName = expr.replaceAll("\\s*[+\\-*/%&|^]?=.*", "");
        } else {
            displayName = "$" + state.scratchCounter;
        }
        String wrapped = "try { var " + varName + " = (" + expr + "); "
            + "System.out.println(\"" + displayName + " ==> \" + __fmt(" + varName + ")); }"
            + " catch (Throwable __e) { System.out.println(\"Exception \" "
            + "+ __e.getClass().getSimpleName() + \": \" + __e.getMessage()); }";
        List<SnippetEvent> events = state.shell.eval(wrapped);
        return events.stream().anyMatch(e -> e.status() == Snippet.Status.VALID);
    }

    /**
     * Eval a snippet normally. Two-phase processing:
     *   Phase 1: shell.eval(source) — compile and execute, collect events
     *   Phase 2: iterate events, collect vars/exprs that need value display
     *   Phase 3: print values via separate shell.eval("println(...)") calls
     */
    private static void evalOneSnippet(SessionState state, String source, StringBuilder errors) {
        List<SnippetEvent> events;
        try {
            events = state.shell.eval(source);
        } catch (Throwable t) {
            errors.append("Exception: ").append(t.toString()).append('\n');
            return;
        }

        List<VarSnippet> varsToShow = new ArrayList<>();
        List<ExpressionSnippet> exprsToShow = new ArrayList<>();

        for (SnippetEvent e : events) {
            Snippet s = e.snippet();
            if (s == null || e.causeSnippet() != null) continue;

            Snippet.Status status = e.status();

            if (status == Snippet.Status.REJECTED) {
                errors.append("Error: ").append(s.source()).append('\n');
                for (Diag d : state.shell.diagnostics(s).toList())
                        errors.append("  ").append(d.getMessage(Locale.ENGLISH)).append('\n');

            } else if (status == Snippet.Status.VALID
                    || status == Snippet.Status.RECOVERABLE_DEFINED
                    || status == Snippet.Status.RECOVERABLE_NOT_DEFINED) {

                if (s instanceof VarSnippet vs) {
                    varsToShow.add(vs);

                } else if (s instanceof ExpressionSnippet es) {
                    exprsToShow.add(es);

                } else if (s instanceof MethodSnippet ms) {
                    boolean isNew = e.previousStatus() == Snippet.Status.NONEXISTENT;
                    String msg = "|  " + (isNew ? "created" : "modified")
                        + " method " + ms.name() + "(" + ms.parameterTypes() + ")";
                    if (status == Snippet.Status.RECOVERABLE_DEFINED
                        || status == Snippet.Status.RECOVERABLE_NOT_DEFINED) {
                        List<String> deps = state.shell.unresolvedDependencies(ms).toList();
                        if (!deps.isEmpty()) {
                            msg += ", however, it cannot be invoked until "
                                + String.join(", and ", deps) + " are declared";
                        }
                    }
                    bufferWrite(msg + "\n");

                } else if (s instanceof TypeDeclSnippet ts) {
                    boolean isNew = e.previousStatus() == Snippet.Status.NONEXISTENT;
                    String kind = s.subKind() == Snippet.SubKind.CLASS_SUBKIND ? "class"
                        : s.subKind() == Snippet.SubKind.INTERFACE_SUBKIND ? "interface"
                        : s.subKind() == Snippet.SubKind.ENUM_SUBKIND ? "enum"
                        : s.subKind() == Snippet.SubKind.RECORD_SUBKIND ? "record" : "type";
                    bufferWrite("|  " + (isNew ? "created" : "modified")
                        + " " + kind + " " + ts.name() + "\n");
                }
            }
        }

        for (VarSnippet vs : varsToShow) {
            state.shell.eval("System.out.println(\"" + vs.name() + " ==> \" + __fmt(" + vs.name() + "));");
        }

        for (ExpressionSnippet es : exprsToShow) {
            String expr = es.source().trim().replaceAll(";$", "");
            state.shell.eval("System.out.println(\"" + expr + " ==> \" + __fmt(" + expr + "));");
        }
    }

    /**
     * Diagnostic tool — returns detailed info about what JShell produces for given input.
     */
    public static String diagnose(String sessionId, String code) {
        SessionState state = sessions.get(sessionId);
        if (state == null) return "ERROR: Session not initialized: " + sessionId;
        try {
            String src = code.trim();
            if (!src.endsWith(";") && !src.endsWith("}")) src = src + ";";
            StringBuilder sb = new StringBuilder();
            List<SnippetEvent> events = state.shell.eval(src);

            sb.append("Input: ").append(code).append('\n');
            sb.append("Events: ").append(events.size()).append('\n');

            for (int i = 0; i < events.size(); i++) {
                SnippetEvent e = events.get(i);
                Snippet s = e.snippet();
                sb.append("\n--- Event ").append(i).append(" ---\n");
                sb.append("  status: ").append(e.status()).append('\n');
                sb.append("  value(): '").append(e.value()).append("'\n");
                sb.append("  causeSnippet: ").append(e.causeSnippet()).append('\n');

                if (s != null) {
                    sb.append("  snippet.class: ").append(s.getClass().getSimpleName()).append('\n');
                    sb.append("  snippet.kind: ").append(s.kind()).append('\n');
                    sb.append("  snippet.subKind: ").append(s.subKind()).append('\n');
                    sb.append("  snippet.source: '").append(s.source()).append("'\n");

                    if (s instanceof VarSnippet vs) {
                        sb.append("  varSnippet.name: ").append(vs.name()).append('\n');
                        sb.append("  varSnippet.typeName: ").append(vs.typeName()).append('\n');
                        try {
                            String vv = state.shell.varValue(vs);
                            sb.append("  shell.varValue(): '").append(vv).append("'\n");
                        } catch (Throwable t) {
                            sb.append("  shell.varValue() ERROR: ").append(t).append('\n');
                        }
                    }
                }
            }

            sb.append("\n--- Session variables ---\n");
            for (VarSnippet vs : state.shell.variables().toList()) {
                String val = "?";
                try { val = state.shell.varValue(vs); } catch (Throwable t) { val = "ERR:" + t; }
                sb.append("  ").append(vs.typeName()).append(' ').append(vs.name())
                    .append(" = '").append(val).append("'\n");
            }

            return sb.toString();
        } catch (Throwable t) {
            return "ERROR: " + t.toString();
        }
    }

    /**
     * Reset a JShell session — destroys current instance and creates a fresh one.
     * All variables, methods, classes, and imports are cleared.
     */
    public static String reset(String sessionId) {
        try {
            SessionState state = sessions.get(sessionId);
            if (state != null && state.shell != null) state.shell.close();
            SessionState newState = new SessionState();
            newState.shell = JShell.builder()
                .executionEngine("local")
                .out(switchStream)
                .err(switchStream)
                .build();
            newState.sca = newState.shell.sourceCodeAnalysis();
            newState.scratchCounter = 0;
            initFormatter(newState.shell);
            sessions.put(sessionId, newState);
            return "OK";
        } catch (Throwable t) {
            return "ERROR: " + t.toString();
        }
    }

    /**
     * Close and remove a JShell session. Called when a tab is closed.
     */
    public static String close(String sessionId) {
        try {
            SessionState state = sessions.remove(sessionId);
            if (state != null && state.shell != null) state.shell.close();
            return "OK";
        } catch (Throwable t) {
            return "ERROR: " + t.toString();
        }
    }
}
