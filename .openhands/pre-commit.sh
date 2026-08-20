#!/usr/bin/env bash
set -euo pipefail

pnpm run lint

pnpm run format:check

pnpm run test

echo "Pre-commit checks passed."
