#!/usr/bin/env bash
# Copy the locally built numeric grids (data/grids) to a server over SSH.
#   scripts/sync-grids.sh user@host:/path/to/earth-explorer
# Resumable: run it again after a dropped connection and it continues where it stopped.
# BWLIMIT=500 limits the upload to 500 KiB/s so a weak link stays usable.
set -euo pipefail

cd "$(dirname "$0")/.."
dest="${1:?usage: scripts/sync-grids.sh user@host:/path/to/earth-explorer}"
command -v rsync >/dev/null || { echo "rsync is not installed" >&2; exit 1; }
[ -d data/grids ] || { echo "data/grids does not exist; run 'make grids' first" >&2; exit 1; }

rsync -a --partial --info=progress2 ${BWLIMIT:+--bwlimit="$BWLIMIT"} \
  data/grids/ "${dest%/}/data/grids/"
echo "grids copied; restart the API on the server: docker compose restart api"
