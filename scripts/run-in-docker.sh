#!/usr/bin/env bash
# Runs one of the test scripts inside the Docker network of the full stack, so the numbers are not
# held back by Windows networking. Usage:  scripts/run-in-docker.sh load-test.mjs
# Environment variables (USERS, CONC, SSE_USERS, STATUS_CONC, DROP_ID) are passed through.
set -euo pipefail
export MSYS_NO_PATHCONV=1   # stop Git Bash rewriting the container paths below
cd "$(dirname "$0")/.."
SCRIPT="${1:-load-test.mjs}"
TEST_KEY="$(grep ^TEST_KEY deploy/.env | cut -d= -f2)"
HERE="$(pwd -W 2>/dev/null || pwd)"
docker run --rm --network fairdrop-stack_default \
  -v "${HERE}/scripts:/work" -w /work \
  -e BASE_URL="${BASE_URL:-http://nginx/api/v1}" \
  -e DATABASE_URL="postgres://fairdrop:fairdrop@postgres:5432/fairdrop" \
  -e REDIS_URL="redis://redis:6379" \
  -e TEST_KEY="$TEST_KEY" \
  -e USERS -e CONC -e THREADS -e SSE_USERS -e STATUS_CONC -e DROP_ID \
  node:22-alpine node "$SCRIPT"
