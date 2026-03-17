#!/bin/bash
# Start local HTTP server and open the notebook in a browser

PORT=8080
DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$DIR"

# Start Python HTTP server in background
python -m http.server $PORT &
SERVER_PID=$!

echo "Server started on http://localhost:$PORT (PID: $SERVER_PID)"

# Wait a moment for server to start
sleep 1

# Open browser (cross-platform)
if command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:$PORT"
elif command -v open &>/dev/null; then
    open "http://localhost:$PORT"
elif command -v start &>/dev/null; then
    start "http://localhost:$PORT"
else
    echo "Open http://localhost:$PORT in your browser"
fi

echo "Press Ctrl+C to stop the server"

# Wait for Ctrl+C, then kill the server
trap "kill $SERVER_PID 2>/dev/null; echo 'Server stopped.'; exit 0" INT
wait $SERVER_PID
