#!/usr/bin/env bash
set -euo pipefail

# TypeScript type checking for all packages
echo "Type checking devices..."
(cd packages/devices && npx tsc --noEmit)

echo "Type checking lang-core..."
(cd packages/lang-core && npx tsc --noEmit)

echo "Type checking vm..."
(cd packages/vm && npx tsc --noEmit)

echo "Type checking playground..."
(cd packages/playground && npx tsc --noEmit)

# Run tests (playground has no tests)
echo "Running tests..."
(cd packages/devices && npm run test)
(cd packages/lang-core && npm run test)
(cd packages/vm && npm run test)

echo "Pre-commit checks passed."
