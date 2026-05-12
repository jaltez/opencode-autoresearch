#!/usr/bin/env bash
set -euo pipefail

grep -q '^this-will-not-match$' app.txt
