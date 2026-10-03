#!/usr/bin/env bash
# Builds and starts (or updates) the full stack, then reloads nginx (no dropped connections) so it picks
# up the current addresses of the API containers. Run from anywhere:  deploy/up.sh
# Extra docker compose files can be added with COMPOSE_EXTRA, for example:
#   COMPOSE_EXTRA="-f deploy/docker-compose.expose.yml" deploy/up.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f deploy/.env ]; then
  echo "deploy/.env is missing. Copy deploy/.env.example to deploy/.env and fill in the secrets." >&2
  exit 1
fi

FILES="-f deploy/docker-compose.yml ${COMPOSE_EXTRA:-}"
docker compose $FILES up -d --build
docker compose $FILES exec -T nginx nginx -s reload

# Wait until the API answers through nginx.
PORT="$(grep -E '^HTTP_PORT=' deploy/.env | cut -d= -f2)"
for i in $(seq 1 30); do
  if curl -fsS "http://localhost:${PORT:-80}/api/v1/health" >/dev/null 2>&1; then
    echo "Stack is up: http://localhost:${PORT:-80}"
    exit 0
  fi
  sleep 1
done
echo "The API did not become healthy in 30 seconds. Check: docker compose $FILES logs api1 api2" >&2
exit 1
