#!/bin/bash
# Trading Command Center - Production Server Startup
# Auto-restarts on crash

cd /home/z/my-project

# Kill any existing server on port 3000
lsof -i :3000 2>/dev/null | awk 'NR>1{print $2}' | sort -u | xargs -r kill -9 2>/dev/null
sleep 1

# Copy static assets to standalone (required for standalone builds)
cp -r .next/static .next/standalone/.next/static 2>/dev/null
cp -r public .next/standalone/public 2>/dev/null

echo "Starting Trading Command Center..."

# Start server with auto-restart loop
(
  while true; do
    cd /home/z/my-project/.next/standalone
    PORT=3000 node server.js >> /tmp/tcc_server.log 2>&1
    echo "[$(date)] Server exited, restarting in 2s..." >> /tmp/tcc_server.log
    sleep 2
  done
) &

SERVER_PID=$!
disown $SERVER_PID 2>/dev/null

echo "Watchdog PID: $SERVER_PID"
sleep 3

# Verify
if ss -tlnp 2>/dev/null | rg -q 3000; then
  echo "Trading Command Center is RUNNING on http://localhost:3000"
else
  echo "Failed to start - check /tmp/tcc_server.log"
  exit 1
fi
