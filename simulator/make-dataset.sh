#!/usr/bin/env bash
# Builds the offline training and test set into runs/ (one folder per run).
# usage: ./make-dataset.sh [seeds, default 1-5]
set -euo pipefail
cd "$(dirname "$0")"
SEEDS="${1:-1-5}"

node src/offline.js config/s0-baseline.yaml --seeds "$SEEDS"

for s in s1-naive-farm s2-stealth-farm s3-retry-spammer s4-flooder s5-payment-reuse s6-mixed; do
  for pct in 10 30 50; do
    node src/offline.js "config/$s.yaml" --seeds "$SEEDS" --set botSharePercent=$pct
  done
done

# with rate limits on almost no S3 or S4 bot gets in, so also build runs where they do
for s in s3-retry-spammer s4-flooder; do
  node src/offline.js "config/$s.yaml" --seeds "$SEEDS" --set defences.rateLimits=false
done
node src/offline.js config/s4-flooder.yaml --seeds "$SEEDS" --set defences.pow=false
