#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

echo "build:"
sh "$root/tools/build.sh"

echo "structure:"
gjs -m "$root/tests/syntax.js"

echo "shell scripts:"
for f in "$root"/bin/mwa-inspect "$root"/bin/mwa-add-rule "$root"/tests/*.sh; do
    bash -n "$f" && echo "  ok   ${f#"$root"/}"
done

echo "rules, preferences logic, both flavours:"
gjs -m "$root/tests/run.js"
