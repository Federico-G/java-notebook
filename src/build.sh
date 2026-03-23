#!/bin/bash
# Build JShellBridge and copy to public/jshell/
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD="$SCRIPT_DIR/build"
OUT="$PROJECT_DIR/public/jshell"
CP="$OUT/jdk.jshell.jar;$OUT/jdk.compiler_17.jar"

# Use : separator on non-Windows
if [[ "$OSTYPE" != "msys" && "$OSTYPE" != "cygwin" && "$OSTYPE" != "win32" ]]; then
    CP="$OUT/jdk.jshell.jar:$OUT/jdk.compiler_17.jar"
fi

rm -rf "$BUILD" && mkdir -p "$BUILD" "$OUT"

echo "Compiling JShellBridge..."
javac --release 17 -cp "$CP" -d "$BUILD" "$SCRIPT_DIR/JShellBridge.java" || exit 1

echo "Copying to public/jshell/..."
cp "$BUILD"/*.class "$OUT/"
echo "Done. Classes:"
ls "$OUT"/JShellBridge*.class
