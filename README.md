# Java Notebook

Notebook de Java 100% client-side que corre en el navegador. El compilador Java (javac) y TeaVM corren en WebAssembly — no necesita servidor, backend, ni instalación. Permite escribir y ejecutar código Java directamente en el navegador, con celdas de código y markdown al estilo Jupyter.

**Probalo online:** https://federico-g.github.io/java-notebook/

## Cómo funciona

1. Escribís código Java en las celdas del notebook
2. Al ejecutar una celda, el código se envuelve en una clase Java
3. Un Web Worker compila el código con javac y genera WASM con TeaVM
4. El WASM se ejecuta en un iframe sandboxed
5. La salida (stdout/stderr) se captura y muestra debajo de la celda

### Celdas Global vs Local

- **Local** (default): la celda se ejecuta de forma independiente
- **Global**: el código de la celda se incluye al compilar celdas posteriores, para compartir clases, variables, etc.

El scope se puede cambiar desde el menú de cada celda.

### Configuración

Desde el ícono de engranaje en la barra superior:

- **Tema**: Auto (sigue al sistema), Claro, u Oscuro
- **Identación**: 2 o 4 espacios
- **Modo**: Edición (todos los controles visibles) o Lectura (oculta controles de edición)
- **Atajos generales**: On/Off (default Off) — habilita Ctrl+X/C/V/Z/Delete para cortar, copiar, pegar, deshacer y eliminar celdas cuando el foco está fuera del editor

La configuración se guarda en `localStorage`. Presionar `?` para ver los atajos de teclado disponibles.

### Limitaciones de TeaVM

El compilador TeaVM tiene algunas limitaciones al correr en el navegador:

- `String.format()` / `System.out.printf()` — no funcionan
- `Scanner` / `System.in` — no hay stdin en el browser
- Reflection — muy limitada
- `java.io.File` — no hay filesystem

Para la lista completa, ver `TEAVM-LIMITATIONS.md`.

### Actualizar ejemplos

Los notebooks de ejemplo están en `public/examples/`. Para agregar o modificar un ejemplo:

1. Crear o editar el archivo `.ipynb` en `public/examples/`
   - Se puede exportar un notebook desde la app con el botón **Exportar**
2. Agregar la entrada en `public/examples/index.json`:
   ```json
   { "name": "Nombre visible en el menú", "filename": "mi-ejemplo.ipynb" }
   ```

Para eliminar un ejemplo, borrar el `.ipynb` y su entrada en `index.json`. No requiere ninguna herramienta — son archivos estáticos.

---

## Desarrollo

### Requisitos

- [Node.js](https://nodejs.org/) 24 o superior (viene con npm incluido)

Se recomienda instalar Node.js a través de **nvm** (Node Version Manager), que permite manejar múltiples versiones fácilmente:

| Plataforma | nvm | Instalación |
|---|---|---|
| Linux / macOS | [nvm-sh/nvm](https://github.com/nvm-sh/nvm) | `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh \| bash` |
| Windows | [nvm-windows](https://github.com/coreybutler/nvm-windows) | Descargar el instalador desde [Releases](https://github.com/coreybutler/nvm-windows/releases) |

Después de instalar nvm:

```bash
nvm install 24
nvm use 24
```

### Inicio rápido

```bash
git clone git@github.com:Federico-G/java-notebook.git
cd java-notebook
```

**Linux / macOS:**

```bash
bash start.sh
```

**Windows:**

```
start.bat
```

Los scripts verifican que Node.js esté instalado, instalan dependencias automáticamente si hace falta, e inician el servidor de desarrollo.

Equivalente manual:

```bash
npm install
npm run dev
```

El servidor de desarrollo corre en `http://localhost:5173/` con hot reload — los cambios en código se reflejan automáticamente en el navegador.

### Build de producción

```bash
npm run build
```

Genera la carpeta `dist/` con todos los archivos listos para servir como sitio estático.

Para previsualizar el build localmente:

```bash
npm run preview
```

### Actualizar dependencias

```bash
# Ver qué dependencias tienen versiones nuevas
npm outdated

# Actualizar dentro de los rangos de package.json
npm update

# Reconstruir después de actualizar
npm run build
```

Para actualizar una dependencia a una versión major nueva (por ejemplo, `marked` de 15.x a 16.x):

```bash
npm install marked@latest
npm run build
```

### Actualizar TeaVM

Los artefactos del compilador Java → WASM están en `public/teavm/`. Para descargar la última versión desde [teavm.org](https://teavm.org/playground.html) (fuente: [konsoletyper/teavm-javac](https://github.com/konsoletyper/teavm-javac)):

```bash
npm run update-teavm
```

Descarga los 4 artefactos (~6.5 MB total) directamente del servidor oficial.

### Deploy

El deploy a GitHub Pages es automático. Cada push a `main` dispara un GitHub Action que:

1. Instala dependencias (`npm ci`)
2. Genera el build (`npm run build`)
3. Despliega `dist/` a GitHub Pages

Para que funcione, en el repo de GitHub ir a **Settings > Pages** y en Source seleccionar **GitHub Actions**.

### Estructura del proyecto

```
index.html              Punto de entrada (Vite entry point)
css/notebook.css        Estilos responsive mobile-first con dark/light mode
js/                     Lógica de la aplicación (ES modules)
  app.js                Navbar, settings, shortcuts, read mode, autosave, ejemplos
  tab-manager.js        Múltiples notebooks en pestañas, barra tabs + menú acciones
  cell-manager.js       Ciclo de vida de celdas, selección, ejecución, mutaciones DOM
  cell-renderer.js      Creación del DOM para celdas code/markdown (Bootstrap cards)
  editor-setup.js       Factory de CodeMirror 6 (Java + Markdown syntax, keymaps, temas)
  notebook-model.js     Modelo de datos .ipynb (parse/serialize)
  synthetic-class.js    Envuelve snippets en clase Java compilable
  compiler-worker-proxy.js  Proxy al Web Worker del compilador
  execution-manager.js  Ejecución en iframe + captura stdout/stderr
  ipynb-io.js           Import/export .ipynb, drag-drop, autosave
public/                 Archivos estáticos (Vite los copia tal cual a dist/)
  teavm/                Artefactos del compilador Java → WASM (~7 MB)
  frames/               Iframe sandboxed para ejecutar WASM compilado
  examples/             Notebooks de ejemplo (.ipynb)
package.json            Dependencias y scripts npm
vite.config.js          Configuración de Vite
update-teavm.mjs        Script para descargar artefactos TeaVM
start.sh                Script de inicio para Linux/macOS
start.bat               Script de inicio para Windows
```

### Stack técnico

- **[Vite](https://vite.dev/)** — build tool + dev server
- **[Bootstrap 5](https://getbootstrap.com/)** — framework CSS + componentes JS (navbar, tabs, cards, modals)
- **[Bootstrap Icons](https://icons.getbootstrap.com/)** — íconos consistentes en toda la UI
- **[CodeMirror 6](https://codemirror.net/)** — editor de código con syntax highlighting Java y Markdown
- **[marked](https://marked.js.org/)** — renderizado de markdown
- **[teavm-javac](https://github.com/konsoletyper/teavm-javac)** — compilador Java → WASM
