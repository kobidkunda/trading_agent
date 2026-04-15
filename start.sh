#!/bin/bash
cd /home/z/my-project
nohup node .next/standalone/server.js > /tmp/tcc_server.log 2>&1 &
echo $! > /tmp/tcc_server.pid
echo "Server started with PID $(cat /tmp/tcc_server.pid)"
sleep 3
ss -tlnp | grep 3000
