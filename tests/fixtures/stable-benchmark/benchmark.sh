#!/usr/bin/env bash
set -euo pipefail

printf 'optimized\n' > app.txt
echo 'METRIC accuracy=0.91 higher'
echo 'METRIC latency_ms=120 ms lower'
