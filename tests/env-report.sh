#!/usr/bin/env bash
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
UUID="move-windows-auto@dimkarp93"
CONFIG="$HOME/.config/move-windows-auto/rules.json"

section() {
    printf '\n=== %s ===\n' "$1"
}

section "shell and session"
gnome-shell --version 2>/dev/null || echo "gnome-shell not found"
shell_major=$(gnome-shell --version 2>/dev/null | grep -o '[0-9][0-9]*' | head -1)
if [ -n "$shell_major" ]; then
    if [ "$shell_major" -lt 45 ]; then flavour=legacy43; else flavour=esm48; fi
    printf 'flavour   %s (build/%s)\n' "$flavour" "$flavour"
fi
printf 'session   %s\n' "${XDG_SESSION_TYPE:-unknown}"
printf 'desktop   %s\n' "${XDG_CURRENT_DESKTOP:-unknown}"
printf 'gjs       %s\n' "$(gjs --version 2>/dev/null | head -1)"

section "workspaces"
printf 'dynamic   %s\n' "$(gsettings get org.gnome.mutter dynamic-workspaces 2>/dev/null)"
printf 'static n  %s\n' "$(gsettings get org.gnome.desktop.wm.preferences num-workspaces 2>/dev/null)"
printf 'current   %s\n' "$(xprop -root _NET_CURRENT_DESKTOP 2>/dev/null | grep -o '[0-9]*$')"

section "extension"
gnome-extensions info "$UUID" 2>/dev/null || echo "$UUID is not installed"
printf '\nconflicting extensions still enabled:\n'
gnome-extensions list --enabled 2>/dev/null | grep -E 'auto-move-windows' || echo "  none"

section "config"
if [ -f "$CONFIG" ]; then
    printf 'path      %s\n' "$CONFIG"
    gjs -m "$root/tools/mwa.js" config-info "$CONFIG" 2>&1
else
    echo "$CONFIG is missing"
fi

section "open windows as the matcher sees them"
if [ "${XDG_SESSION_TYPE:-}" = "wayland" ]; then
    echo "Wayland session: asking the extension over D-Bus (X11 tools only see XWayland clients)"
    gjs -m "$root/tools/mwa.js" windows 2>&1
    exit 0
fi

if [ -z "${DISPLAY:-}" ]; then
    echo "no DISPLAY, cannot read window properties"
    exit 0
fi

printf '%-10s %-3s %-22s %-22s %-16s %s\n' ID WS WMCLASS INSTANCE ROLE TITLE
for id in $(xprop -root _NET_CLIENT_LIST 2>/dev/null | grep -o '0x[0-9a-f]*'); do
    props=$(xprop -id "$id" WM_CLASS WM_WINDOW_ROLE _NET_WM_NAME 2>/dev/null)
    raw=$(echo "$props" | grep '^WM_CLASS' | sed -n 's/.*= //p')
    instance=$(echo "$raw" | sed 's/",.*//; s/^"//')
    class=$(echo "$raw" | sed 's/.*, "//; s/"$//')
    role=$(echo "$props" | grep '^WM_WINDOW_ROLE' | sed -n 's/.*= //p' | tr -d '"')
    title=$(echo "$props" | grep '^_NET_WM_NAME' | sed -n 's/.*= //p' | tr -d '"')
    ws=$(wmctrl -l 2>/dev/null | awk -v w="$(printf '0x%08x' "$id")" '$1 == w {print $2; exit}')
    printf '%-10s %-3s %-22s %-22s %-16s %s\n' \
        "$id" "${ws:--}" "${class:--}" "${instance:--}" "${role:--}" "${title:--}"
done
