# Java Notebook

Notebook de Java 100% client-side que corre en el navegador. Java 17 completo corre en WebAssembly via CheerpJ + JShell. Sin servidor, sin backend, sin instalacion.

## Arquitectura

```
index.html              → Punto de entrada (Vite entry point)
css/notebook.css        → Estilos responsive mobile-first con dark mode
js/
  app.js                → Bootstrap, navbar, settings, shortcuts modal, read mode, autosave, ejemplos, import por URL
  tab-manager.js        → Multiples notebooks en pestanas, barra de tabs + menu de acciones
  cell-manager.js       → Ciclo de vida de celdas, seleccion, ejecucion, mutaciones DOM targeted
  cell-renderer.js      → Creacion del DOM para celdas code/markdown (Bootstrap cards)
  editor-setup.js       → Factory de CodeMirror 6 (Java syntax, Markdown syntax, keymaps, indent, dark theme)
  notebook-model.js     → Modelo de datos .ipynb (parse/serialize)
  jshell-proxy.js       → Proxy a CheerpJ + JShellBridge (init, eval, reset, close por sesion)
  ipynb-io.js           → Import/export .ipynb, drag-drop, autosave multi-tab
src/
  JShellBridge.java     → Bridge multi-sesion entre JS y JShell (CheerpJ library mode)
  build.sh              → Compila JShellBridge.java y copia .class a public/jshell/
public/                 → Archivos estaticos (Vite los copia tal cual a dist/)
  jshell/               → JARs de JShell + clases compiladas (~5.6MB)
    jdk.compiler_17.jar → javac extraido de Temurin JDK 17
    jdk.jshell.jar      → JShell + dependencias (8 modulos JDK, parcheado para CheerpJ)
    JShellBridge*.class → Clases compiladas del bridge
  examples/             → Notebooks de ejemplo (.ipynb), listados en index.json
package.json            → Dependencias npm + scripts (dev, build, preview)
vite.config.js          → Config de Vite (base path para GitHub Pages)
update-jshell.mjs       → Script para reconstruir artefactos JShell desde Temurin JDK 17
start.sh                → Script de inicio para Linux/macOS
start.bat               → Script de inicio para Windows
```

## Stack tecnico

- **Vite**: build tool + dev server, resuelve dependencias desde node_modules/
- **Bootstrap 5** via npm: framework CSS + componentes JS (navbar, nav-tabs, cards, modals, dropdowns)
- **Bootstrap Icons** via npm: iconos consistentes en toda la UI
- **CodeMirror 6** via npm: editor, syntax highlighting Java + Markdown, search
- **marked.js** via npm: renderizado de markdown
- **CheerpJ**: JVM completa en WebAssembly, cargada desde CDN
- **JShell**: REPL de Java 17 para evaluacion interactiva de codigo
- **@codemirror/theme-one-dark**: tema oscuro, togglable desde settings (Auto/Claro/Oscuro)
- **@codemirror/lang-markdown**: syntax highlighting para editor de celdas markdown

## Como funciona la ejecucion

1. CheerpJ se inicializa una vez al cargar la pagina (carga JVM WASM desde CDN)
2. JShellBridge se carga via `cheerpjRunLibrary()` en library mode
3. Cada tab crea una sesion JShell independiente via `JShellBridge.init(sessionId)`
4. Al ejecutar una celda, `jshell-proxy.js` llama a `JShellBridge.eval(sessionId, code)`
5. JShell compila y ejecuta el snippet. Variables, clases y metodos persisten en la sesion
6. La salida se captura de dos fuentes: Java `SwitchOutputStream` buffer + CheerpJ `#console` DOM
7. "Reiniciar y ejecutar todo" hace reset de la sesion y ejecuta todas las celdas en orden

## Sesiones JShell por tab

- Cada tab tiene su propia sesion JShell (Map<String, SessionState> en Java)
- Las sesiones son independientes. Variables de un tab no afectan a otro
- "Reiniciar sesion" destruye y recrea la sesion JShell del tab activo
- Al cerrar un tab se destruye su sesion (`JShellBridge.close(sessionId)`)
- Las evaluaciones se serializan via promise chain, solo una eval a la vez (output capture compartido)

## JShellBridge (src/JShellBridge.java)

Bridge multi-sesion entre JavaScript y JShell en CheerpJ. Estrategia de evaluacion en 3 niveles:

1. `throw` statements → wrapeados en try/catch (CheerpJ traga excepciones)
2. Expresiones → wrapeadas en try/catch con captura de valor via variable nombrada
3. Declaraciones/statements → eval normal con display de valores post-iteracion

Workarounds para CheerpJ:
- `SnippetEvent.value()` siempre retorna null, no usable
- `shell.varValue()` retorna defaults (0, null, false), no usable
- Se usa `shell.eval("println(varName)")` para leer valores reales
- Excepciones del LocalExecutionControl se tragan silenciosamente, wrap en try/catch

## Limitaciones de CheerpJ

- `Scanner` / `System.in`: NO hay stdin en browser
- `java.io.File`: NO hay filesystem
- Algunas excepciones no se lanzan (ej: `1/0` retorna 0 en vez de ArithmeticException)
- Primera ejecucion lenta (~5-10s) mientras CheerpJ inicializa la JVM
- CheerpJ se carga desde CDN, requiere conexion a internet

## UI: menus y controles

**Menu Archivo** (navbar dropdown):
- Importar: abre un .ipynb desde disco (tambien drag-drop)
- Exportar: descarga el notebook actual
- Ejemplos: notebooks de ejemplo cargados desde `public/examples/index.json`

**Configuracion** (engranaje en navbar):
- Tema: Auto, Claro, Oscuro
- Identacion: 2 o 4 espacios
- Modo: Edicion o Lectura (alterna controles de edicion)
- Atajos generales: On u Off

**Menu del notebook** (icono ⋮ a la derecha de la barra de tabs):
- Reiniciar y ejecutar todo
- Reiniciar sesion
- Agregar celda: Codigo, Texto
- Celda seleccionada: Subir, Bajar, Cortar, Copiar, Pegar, Eliminar, Deshacer eliminar

**Pestanas**:
- Boton + para nuevo notebook
- Doble clic en pestana para renombrar (long-press en mobile)
- Boton X para cerrar

**Celdas de codigo**: boton Ejecutar, botones Subir/Bajar/Eliminar, botones Copiar/Limpiar resultado
**Celdas de markdown**: doble clic para editar, botones Editar/Listo, Subir/Bajar/Eliminar

## Import por URL

Se puede abrir un notebook desde una URL con el query parameter `?url=`:
```
https://sitio.com/?url=https://ejemplo.com/notebook.ipynb
```
- Hace fetch del .ipynb, lo parsea y abre como tab nuevo
- Muestra "Notebook importado: nombre" en el loading overlay
- Si ya hay otra pestana del navegador abierta, delega via BroadcastChannel y muestra "Notebook enviado a la pestana abierta"

## Settings

Se guardan en localStorage key `java-notebook-settings`:
- `theme`: system, light o dark (default system)
- `indentSize`: 2 o 4 espacios (default 4)
- `readMode`: true/false (default false). Modo lectura oculta controles de edicion
- `shortcuts`: true/false (default false). Habilita atajos idle (cut/copy/paste/delete/undo celda)

Los tabs/notebooks se guardan en localStorage key `java-notebook-autosave` (formato multi-tab).

## Atajos de teclado

Hay dos categorias de atajos globales (Ctrl+key):

**Always-on**, funcionan siempre, incluso dentro del editor (bloqueados solo por modals/dropdowns):

| Atajo | Accion |
|---|---|
| Ctrl+S | Exportar notebook |
| Ctrl+E | Alternar modo lectura/edicion |
| Ctrl+Up/Down | Navegar entre celdas |

**Idle-only**, requieren foco fuera del editor + setting "Atajos generales" habilitado:

| Atajo | Accion |
|---|---|
| Ctrl+X | Cortar celda |
| Ctrl+C | Copiar celda |
| Ctrl+V | Pegar celda |
| Ctrl+Delete | Eliminar celda |
| Ctrl+Z | Deshacer eliminacion de celda |

**Atajos de editor** (dentro de CodeMirror, no dependen del setting):

| Atajo | Accion |
|---|---|
| Shift+Enter | Ejecutar y quedarse (code) / Salir edicion (markdown) |
| Ctrl+Enter | Ejecutar y avanzar (code) / Salir y avanzar (markdown) |
| Ctrl+Shift+F | Corregir indentacion |
| Escape | Salir de edicion markdown |
| ? | Mostrar/ocultar modal de atajos (fuera de editor) |

## UI: Bootstrap + capa custom

La UI usa componentes de Bootstrap (navbar, nav-tabs, cards, modals, dropdowns, btn-groups) con una capa CSS custom para estilos especificos del notebook:
- Estado de celdas: `.cell--selected` (clase custom, no utilities de Bootstrap)
- Toolbar de markdown: floating overlay con backdrop-filter, aparece en hover
- Add-cell-rows intermedias: altura minima, botones ghost con opacidad 0.25
- Modo lectura: clase `.read-mode` en body oculta controles de edicion via CSS
- Tab bar: scroll arrows en desktop (hover:hover), fade hints en mobile/touch
- Mutaciones DOM targeted: add/delete/move celdas sin reconstruir todo el DOM

## Clipboard y undo por tab

- **Clipboard de celda** (`cellClipboard` en cell-manager.js): global, no por tab. Cut/copy/paste funcionan entre tabs.
- **Undo delete** (`lastDeleted`): per-tab, se guarda/restaura en el objeto tab durante switch/close. Ctrl+Z solo restaura celdas eliminadas en el tab activo.

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

# Reconstruir artefactos JShell desde Temurin JDK 17 (requiere Java 17+)
npm run update-jshell
```
