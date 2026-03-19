# Java Notebook

Notebook de Java 100% client-side que corre en el navegador. El compilador Java (javac) y TeaVM corren en WebAssembly — sin servidor, sin backend, sin instalacion.

## Arquitectura

```
index.html              → Punto de entrada (Vite entry point)
css/notebook.css        → Estilos responsive mobile-first con dark mode
js/
  app.js                → Bootstrap, toolbar, autosave, settings, ejemplos
  tab-manager.js        → Multiples notebooks en pestanas
  cell-manager.js       → Ciclo de vida de celdas, seleccion, ejecucion
  cell-renderer.js      → Creacion del DOM para celdas code/markdown
  editor-setup.js       → Factory de CodeMirror 6 (Java syntax, keymaps, indent, dark theme)
  notebook-model.js     → Modelo de datos .ipynb (parse/serialize)
  synthetic-class.js    → Envuelve snippets de celdas en clase Java compilable
  compiler-worker-proxy.js → Proxy Promise-based al Web Worker de teavm-javac
  execution-manager.js  → Ejecucion en iframe + captura stdout/stderr
  ipynb-io.js           → Import/export .ipynb, drag-drop, autosave multi-tab
public/                 → Archivos estaticos (Vite los copia tal cual a dist/)
  frames/
    run-frame.html/js   → Iframe sandboxed para ejecutar WASM compilado
  teavm/                → Artefactos teavm-javac self-hosted (~7MB)
    compiler.wasm       → javac + TeaVM compilado a WASM
    compiler.wasm-runtime.js → Loader del WASM
    worker.js           → Web Worker que carga el compilador
    *.bin               → Classlibs de Java
  examples/             → Notebooks de ejemplo (.ipynb), listados en index.json
package.json            → Dependencias npm + scripts (dev, build, preview)
vite.config.js          → Config de Vite (base path para GitHub Pages)
update-teavm.mjs        → Script para descargar artefactos TeaVM desde teavm.org
start.sh                → Script de inicio para Linux/macOS
start.bat               → Script de inicio para Windows
```

## Stack tecnico

- **Vite** — build tool + dev server, resuelve dependencias desde node_modules/
- **Bootstrap 5** via npm — framework CSS + componentes JS (sin jQuery)
- **CodeMirror 6** via npm — editor, syntax highlighting Java, search
- **marked.js** via npm — renderizado de markdown
- **teavm-javac** — compilador Java a WASM que corre en Web Worker
- **@codemirror/theme-one-dark** — tema oscuro, togglable desde settings (Auto/Claro/Oscuro)

## Como funciona la compilacion

1. Todo el codigo de las celdas se envuelve en `synthetic-class.js` dentro de un `public static void main()`
2. Imports se extraen y se ponen arriba de la clase
3. Marcadores `@@NBCELL@@N` se inyectan entre celdas para filtrar output por celda
4. El Worker compila con javac y luego genera WASM con TeaVM
5. El iframe ejecuta el WASM y captura stdout/stderr char por char via postMessage

## Celdas Global vs Local

- **Local** (default): se ejecuta de forma completamente independiente
- **Global**: se incluye al compilar celdas posteriores (para compartir clases, variables)
- El scope se guarda en `cell.metadata.scope`

## Protocolo del Worker (teavm-javac)

- Worker → Main: `{ command: "initialized" }`
- Main → Worker: `{ command: "load-classlib", id, url, runtimeUrl }`
- Worker → Main: `{ command: "ok", id }`
- Main → Worker: `{ command: "compile", id, text }`
- Worker → Main: `{ command: "compilation-complete", id, status, script }`

## Limitaciones de TeaVM

Ver `TEAVM-LIMITATIONS.md` para la lista completa. Lo mas importante:
- `String.format()` / `System.out.printf()` — NO funcionan
- `Scanner` / `System.in` — NO hay stdin en browser
- Reflection — muy limitada
- `java.io.File` — NO hay filesystem

## Settings

Se guardan en localStorage key `java-notebook-settings`:
- `theme`: system, light o dark (default system)
- `indentSize`: 2 o 4 espacios (default 4)

Los tabs/notebooks se guardan en localStorage key `java-notebook-autosave` (formato v2 multi-tab).

## Idioma

La UI esta en español. Los terminos tecnicos se mantienen en ingles.

## Deploy

GitHub Actions build + deploy automatico en cada push a main. El workflow (`.github/workflows/deploy.yml`) ejecuta `npm ci && npm run build` y despliega `dist/` a GitHub Pages via Actions deployment. En el repo settings de GitHub Pages, la source debe ser "GitHub Actions".

## Comandos utiles

```bash
# Instalar dependencias
npm install

# Servidor de desarrollo con hot reload
npm run dev

# Build de produccion
npm run build

# Preview del build local
npm run preview

# Ver dependencias desactualizadas
npm outdated

# Actualizar dependencias
npm update
npm run build

# Actualizar TeaVM (descarga artefactos de teavm.org)
npm run update-teavm
```
