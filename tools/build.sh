#!/bin/sh
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
build="$root/build"
dist="$root/dist"

to_legacy() {
    name=$1
    src=$2
    dst=$3

    sed \
        -e "s|^import \([A-Za-z0-9_]*\) from 'gi://\1';\$|const {\1} = imports.gi;|" \
        -e "s|^import \* as \([A-Za-z0-9_]*\) from '\./\([A-Za-z0-9_]*\)\.js';\$|const \1 = _ext.lib.\2;|" \
        -e 's|^export class \([A-Za-z0-9_]*\)|var \1 = class \1|' \
        -e 's|^export const |var |' \
        -e 's|^export let |var |' \
        -e 's|^export \(function\)|\1|' \
        -e 's|^export \(async function\)|\1|' \
        "$src" > "$dst"

    if bad=$(grep -n '^\(import\|export\) ' "$dst"); then
        echo "build: $name: unsupported statement: $bad" >&2
        exit 1
    fi

    if grep -q '_ext\.lib\.' "$dst"; then
        {
            cat <<'PROLOGUE'
const _ext = (() => {
    try {
        return imports.misc.extensionUtils.getCurrentExtension().imports;
    } catch (e) {
        return imports;
    }
})();

PROLOGUE
            cat "$dst"
        } > "$dst.tmp"
        mv "$dst.tmp" "$dst"
    fi
}

build_flavour() {
    flavour=$1
    entry=$2
    target="$build/$flavour"

    rm -rf "$target"
    mkdir -p "$target/lib"

    for f in "$root"/src/lib/*.js; do
        if [ "$flavour" = legacy43 ]; then
            to_legacy "src/lib/${f##*/}" "$f" "$target/lib/${f##*/}"
        else
            cp "$f" "$target/lib/"
        fi
    done

    cp "$root/src/$entry"/* "$target/"
    cp "$root/rules.default.json" "$target/"
    echo "built build/$flavour"
}

pack_flavour() {
    flavour=$1
    target="$build/$flavour"
    uuid=$(sed -n 's/.*"uuid"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$target/metadata.json")
    archive="$dist/$uuid.$flavour.shell-extension.zip"

    mkdir -p "$dist"
    rm -f "$archive"
    (cd "$target" && zip -qrX "$archive" .)
    echo "packed dist/${archive##*/}"
}

pack=0
[ "${1:-}" = --pack ] && pack=1

for pair in legacy43:legacy esm48:esm; do
    flavour=${pair%%:*}
    build_flavour "$flavour" "${pair#*:}"
    [ "$pack" = 1 ] && pack_flavour "$flavour"
done
exit 0
