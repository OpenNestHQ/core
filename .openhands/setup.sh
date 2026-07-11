#!/usr/bin/env bash
set -euo pipefail

# Install dependencies for all packages
for pkg in devices lang-core vm playground; do
  if [ ! -d "packages/$pkg/node_modules" ]; then
    echo "Installing dependencies for packages/$pkg..."
    (cd "packages/$pkg" && npm install)
  fi
done

# Build packages in dependency order
# devices and lang-core are independent (parallel-safe)
echo "Building devices and lang-core..."
(cd packages/devices && npm run build) &
(cd packages/lang-core && npm run build) &
wait

# vm depends on both devices and lang-core
echo "Building vm..."
(cd packages/vm && npm run build)

# playground depends on all three
echo "Building playground..."
(cd packages/playground && npm run build)

echo "Setup complete."
