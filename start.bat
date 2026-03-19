@echo off
REM Instala dependencias (si hace falta) e inicia el servidor de desarrollo

cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js no esta instalado.
    echo.
    echo Instalalo con nvm:
    echo   Windows: https://github.com/coreybutler/nvm-windows
    echo.
    echo Despues ejecuta:  nvm install 24 ^&^& nvm use 24
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Instalando dependencias...
    call npm install
)

echo Iniciando servidor de desarrollo...
npx vite --open
