#!/bin/bash
echo "Testing Mode Switch..."
curl -v -H "x-role: Admin" -H "LOCAL_DEV_AUTH_BYPASS: true" -X PUT http://localhost:6500/api/trading/mode -d '{"mode": "PAPER"}'
