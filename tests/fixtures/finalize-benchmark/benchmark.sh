#!/usr/bin/env bash
set -euo pipefail

if grep -q '^baseline-a$' feature-a.txt; then
  printf 'improved-a\n' > feature-a.txt
  echo 'METRIC accuracy=0.91 higher'
else
  printf 'improved-b\n' > feature-b.txt
  echo 'METRIC accuracy=0.95 higher'
fi
