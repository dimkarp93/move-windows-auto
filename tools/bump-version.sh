#!/bin/sh
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
files="src/esm/metadata.json src/legacy/metadata.json"
remote=origin

fail() {
    echo "bump-version: $*" >&2
    exit 1
}

normalize() {
    sed -e 's|^ssh://||' -e 's|^git@\([^:/]*\)[:/]|https://\1/|' -e 's|\.git$||' -e 's|/*$||'
}

field() {
    sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^\",]*\)\"\{0,1\}.*/\1/p" "$root/$1" | head -n 1
}

replace() {
    sed "s|\(\"$2\"[[:space:]]*:[[:space:]]*\)$3|\1$4|" "$root/$1" > "$root/$1.tmp"
    mv "$root/$1.tmp" "$root/$1"
}

url=
keep=0
no_git=0
for arg in "$@"; do
    case $arg in
        --keep-version) keep=1 ;;
        --no-git) no_git=1 ;;
        -*) fail "unknown option $arg" ;;
        *) [ -z "$url" ] || fail 'only one url may be given'; url=$(echo "$arg" | normalize) ;;
    esac
done

uuid=$(field src/esm/metadata.json uuid)
[ "$uuid" = "$(field src/legacy/metadata.json uuid)" ] || fail 'uuid differs between files'
case ${uuid#*@} in
    ''|*gnome.org) fail "uuid \"$uuid\" must be name@your-namespace, not gnome.org" ;;
esac

git_in() { git -C "$root" "$@"; }

origin=$(git_in remote get-url "$remote" 2>/dev/null | normalize || true)
[ -n "$url" ] || url=$origin
if [ -z "$url" ]; then
    echo "warning: no git remote \"$remote\" and no url argument, url left as is" >&2
fi

current=$(for f in $files; do field "$f" version; done | sort -n | tail -n 1)
version=$current
[ "$keep" = 1 ] || version=$((current + 1))
tag="v$version"

use_git=1
{ [ "$no_git" = 1 ] || [ "$keep" = 1 ]; } && use_git=0

if [ "$use_git" = 1 ]; then
    [ -n "$origin" ] || fail "git remote \"$remote\" is not configured; add it or pass --no-git"
    for f in $files; do
        git_in ls-files --error-unmatch "$f" >/dev/null 2>&1 \
            || fail "$f is not tracked by git; commit it first or pass --no-git"
    done
    git_in rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1 && fail "tag $tag already exists locally"
    [ -z "$(git_in ls-remote --tags "$remote" "refs/tags/$tag")" ] || fail "tag $tag already exists on $remote"
fi

for f in $files; do
    old_url=$(field "$f" url)
    replace "$f" version '[0-9][0-9]*' "$version"
    [ -z "$url" ] || replace "$f" url '"[^"]*"' "\"$url\""
    echo "$f: version $(field "$f" version) url $old_url -> $(field "$f" url)"
done

if [ "$use_git" = 1 ]; then
    git_in add -- $files
    git_in commit -m "bump version to $version" --only -- $files
    git_in tag -a "$tag" -m "$tag"
    git_in push "$remote" "refs/tags/$tag"
    echo "committed, tagged $tag and pushed it to $remote"
fi
