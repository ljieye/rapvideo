#!/bin/sh
# RapVideo — start the site + admin panel.
#   ./start.sh        run in this window (Ctrl-C to stop)
#
# Admin panel:  http://127.0.0.1:3000/admin
# Key:          ADMIN_TOKEN in .env
set -e
cd "$(dirname "$0")"

# the managed node that ships with WorkBuddy; fall back to whatever is on PATH
NODE=/Users/dandan/.workbuddy/binaries/node/versions/22.22.2-6/bin/node
[ -x "$NODE" ] || NODE=$(command -v node)

if lsof -ti:3000 >/dev/null 2>&1; then
  echo "Port 3000 is already in use — the site is probably already running."
  echo "Open: http://127.0.0.1:3000/admin"
  exit 0
fi

echo "Starting RapVideo (this machine loads deps slowly, allow 30-60s)..."
echo "Admin panel: http://127.0.0.1:3000/admin"
exec "$NODE" server.js
