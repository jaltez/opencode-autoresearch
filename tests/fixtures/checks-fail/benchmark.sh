#!/usr/bin/env bash
set -euo pipefail

printf 'broken-change\n' > app.txt
echo 'METRIC accuracy=0.12 higher'
