#!/usr/bin/env bash
# Start the local helper. Loopback only — this is not reachable from another machine.
set -euo pipefail
cd "$(dirname "$0")"
exec uv run uvicorn server:app --host 127.0.0.1 --port 8791 "$@"
