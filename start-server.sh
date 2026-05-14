#!/bin/bash
# Trading Command Center - Server Startup Script
# Ensures static files are in place and starts the production server

cd "$(dirname "$0")"

# Ensure static files are copied
cp -r .next/static .next/standalone/.next/static 2>/dev/null
cp -r public .next/standalone/public 2>/dev/null

# Kill any existing server
PID_FILE=/tmp/tcc_server.pid
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  kill -9 "$OLD_PID" 2>/dev/null
  rm -f "$PID_FILE"
fi
sleep 1

# Start server
PORT=6501 node .next/standalone/server.js &
echo $! > "$PID_FILE"
echo "Trading Command Center started (PID: $(cat $PID_FILE))"
