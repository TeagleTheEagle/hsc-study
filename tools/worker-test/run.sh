#!/usr/bin/env bash
# Runs the Worker unit tests (marking, then plans and billing) against a stub Anthropic SDK and a fake Stripe (no network, no keys).
# Copies worker.js, the test and the stub into a temp folder so the import of
# '@anthropic-ai/sdk' resolves to the stub instead of a real install.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp "$repo/worker.js" "$here/test_worker.mjs" "$here/test_billing.mjs" "$tmp/"
echo '{"type":"module"}' > "$tmp/package.json"
mkdir -p "$tmp/node_modules"
cp -r "$here/stub/@anthropic-ai" "$tmp/node_modules/"
(cd "$tmp" && node test_worker.mjs && node test_billing.mjs)
