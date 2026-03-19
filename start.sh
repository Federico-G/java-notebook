#!/bin/bash
# Instala dependencias (si hace falta) e inicia el servidor de desarrollo

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Verificar que Node.js esté instalado
if ! command -v node &>/dev/null; then
    echo "Node.js no está instalado."
    echo ""
    echo "Instalalo con nvm: https://github.com/nvm-sh/nvm"
    echo ""
    echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
    echo "  nvm install 24 && nvm use 24"
    exit 1
fi

# Instalar dependencias si no existe node_modules/
if [ ! -d "node_modules" ]; then
    echo "Instalando dependencias..."
    npm install
fi

# Iniciar servidor de desarrollo (--open abre el navegador)
echo "Iniciando servidor de desarrollo..."
npx vite --open
