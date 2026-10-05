#!/usr/bin/env bash
set -uo pipefail

UUID="move-windows-auto@dimkarp93"
CONFIG_DIR="$HOME/.config/move-windows-auto"
CONFIG="$CONFIG_DIR/rules.json"
BACKUP=""
ORIG_WS=""

CLASS_PLAIN="mwa-check-plain"
CLASS_REFINE="mwa-check-refine"
CLASS_IGNORED="mwa-check-ignored"
CLASS_STALE="mwa-check-stale"
WS_GENERIC=8
WS_SPECIFIC=9
WS_START=0
DBUS_NAME="org.gnome.Shell.Extensions.MoveWindowsAuto"
DBUS_PATH="/org/gnome/Shell/Extensions/MoveWindowsAuto"

passed=0
failed=0

ok() {
    printf '  ok   %s\n' "$1"
    passed=$((passed + 1))
}

bad() {
    printf '  FAIL %s\n         %s\n' "$1" "$2"
    failed=$((failed + 1))
}

die() {
    printf 'live checks cannot run: %s\n' "$1" >&2
    exit 2
}

list_windows() {
    wmctrl -lx 2>/dev/null || true
}

cleanup() {
    for class in "$CLASS_PLAIN" "$CLASS_REFINE" "$CLASS_IGNORED" "$CLASS_STALE"; do
        for id in $(list_windows | awk -v c=".$class\$" '$3 ~ c {print $1}'); do
            wmctrl -i -c "$id" 2>/dev/null || true
        done
    done
    if [ -n "$ORIG_WS" ] && [ "$(current_workspace)" != "$ORIG_WS" ]; then
        wmctrl -s "$ORIG_WS" 2>/dev/null || true
        printf 'returned to workspace index %s\n' "$ORIG_WS"
    fi
    if [ -n "$BACKUP" ] && [ -f "$BACKUP" ]; then
        cp "$BACKUP" "$CONFIG"
        rm -f "$BACKUP"
        printf 'restored %s\n' "$CONFIG"
        sleep 1
    fi
}

logs_since() {
    journalctl --user -o cat --since "@$1" 2>/dev/null | grep MWA || true
}

wait_for_window() {
    local class="$1" deadline=$((SECONDS + 10))
    while [ "$SECONDS" -lt "$deadline" ]; do
        local line
        line=$(list_windows | awk -v c=".$class\$" '$3 ~ c {print $1, $2; exit}')
        if [ -n "$line" ]; then
            echo "$line"
            return 0
        fi
        sleep 0.2
    done
    return 1
}

window_workspace() {
    list_windows | awk -v c=".$1\$" '$3 ~ c {print $2; exit}'
}

window_id() {
    list_windows | awk -v c=".$1\$" '$3 ~ c {print $1; exit}'
}

current_workspace() {
    xprop -root _NET_CURRENT_DESKTOP 2>/dev/null | grep -o '[0-9]*$'
}

normalize_id() {
    [ -n "$1" ] && printf '0x%x' "$1"
}

active_window_id() {
    normalize_id "$(xprop -root _NET_ACTIVE_WINDOW 2>/dev/null | grep -o '0x[0-9a-f]*' | head -1)"
}

spawn() {
    local class="$1" script="$2"
    kitty --class "$class" sh -c "$script" >/dev/null 2>&1 &
}

reload_config() {
    gdbus call --session --dest "$DBUS_NAME" --object-path "$DBUS_PATH" \
        --method "$DBUS_NAME.Reload" >/dev/null 2>&1
}

write_test_config() {
    cat > "$CONFIG" <<EOF
{
  "settleMs": 2500,
  "debug": true,
  "rules": [
    {
      "name": "check-stale-specific",
      "match": { "wmClass": "^$CLASS_STALE\$", "title": "^never-happens\$" },
      "workspace": $WS_SPECIFIC
    },
    {
      "name": "check-stale",
      "match": { "wmClass": "^$CLASS_STALE\$" },
      "workspace": $WS_GENERIC,
      "follow": true,
      "focus": true
    },
    {
      "name": "check-specific",
      "match": { "wmClass": "^$CLASS_REFINE\$", "title": "^refine-final\$" },
      "workspace": $WS_SPECIFIC
    },
    {
      "name": "check-refine",
      "match": { "wmClass": "^$CLASS_REFINE\$" },
      "workspace": $WS_GENERIC
    },
    {
      "name": "check-plain",
      "match": { "wmClass": "^$CLASS_PLAIN\$" },
      "workspace": $WS_GENERIC
    }
  ]
}
EOF
}

close_class() {
    for id in $(list_windows | awk -v c=".$1\$" '$3 ~ c {print $1}'); do
        wmctrl -i -c "$id" 2>/dev/null || true
    done
    sleep 0.5
}

[ -n "${DISPLAY:-}" ] || die "no DISPLAY, these checks are X11 only"
[ "${XDG_SESSION_TYPE:-}" != "wayland" ] || die "Wayland session, wmctrl cannot drive windows"
for tool in wmctrl kitty journalctl xprop gnome-extensions gdbus; do
    command -v "$tool" >/dev/null || die "$tool is required"
done
gnome-extensions info "$UUID" 2>/dev/null | grep -q 'State: ENABLED' \
    || die "$UUID is not enabled, run: just dev"
[ -f "$CONFIG" ] || die "$CONFIG is missing, run: just seed-config"

ORIG_WS=$(current_workspace)

trap cleanup EXIT

BACKUP=$(mktemp)
cp "$CONFIG" "$BACKUP"
printf 'backed up %s\n\n' "$CONFIG"

write_test_config

sleep 1.5

printf 'config reload\n'
start=$(date +%s)
sleep 1.5
if logs_since "$((start - 3))" | grep -q 'loaded 5 rules'; then
    bad "a file edit alone does not reload the config" \
        "the extension reloaded without an explicit Reload call"
else
    ok "a file edit alone does not reload the config"
fi

start=$(date +%s)
reload_config
sleep 1.5
if logs_since "$((start - 3))" | grep -q 'loaded 5 rules'; then
    ok "test config is applied by an explicit Reload call"
else
    bad "test config is applied by an explicit Reload call" \
        "expected a 'loaded 5 rules' line in the journal"
fi

printf 'broken config\n'
start=$(date +%s)
printf '{ "rules": [ ' > "$CONFIG"
reload_config
sleep 1.5
if logs_since "$start" | grep -q 'config rejected, keeping previous rules'; then
    ok "broken JSON is rejected and previous rules survive"
else
    bad "broken JSON is rejected and previous rules survive" \
        "expected a 'config rejected' line in the journal"
fi

start=$(date +%s)
write_test_config
reload_config
sleep 1.5
if logs_since "$start" | grep -q 'loaded 5 rules'; then
    ok "a repaired config is reloaded again"
else
    bad "a repaired config is reloaded again" "expected a 'loaded 5 rules' line"
fi

printf 'placement with stable properties only\n'
start=$(date +%s)
spawn "$CLASS_PLAIN" 'printf "\033]0;plain\007"; sleep 8'
if ! wait_for_window "$CLASS_PLAIN" >/dev/null; then
    bad "window with only stable predicates is placed at once" "window never appeared"
else
    sleep 3.5
    actual=$(window_workspace "$CLASS_PLAIN")
    if [ "$actual" = "$((WS_GENERIC - 1))" ]; then
        ok "window with only stable predicates lands on workspace $WS_GENERIC"
    else
        bad "window with only stable predicates lands on workspace $WS_GENERIC" \
            "it is on workspace index $actual, expected $((WS_GENERIC - 1))"
    fi
    if logs_since "$start" | grep -q '\[check-plain\] -> workspace '"$WS_GENERIC"' (created)'; then
        ok "it is moved on creation, with no provisional step"
    else
        bad "it is moved on creation, with no provisional step" \
            "expected '[check-plain] -> workspace $WS_GENERIC (created)'"
    fi
fi
close_class "$CLASS_PLAIN"

printf 'provisional placement refined by a late title\n'
start=$(date +%s)
spawn "$CLASS_REFINE" 'printf "\033]0;refine-start\007"; sleep 1.2; printf "\033]0;refine-final\007"; sleep 8'
if ! wait_for_window "$CLASS_REFINE" >/dev/null; then
    bad "window is refined once the title arrives" "window never appeared"
else
    sleep 4
    actual=$(window_workspace "$CLASS_REFINE")
    if [ "$actual" = "$((WS_SPECIFIC - 1))" ]; then
        ok "late title moves the window on to workspace $WS_SPECIFIC"
    else
        bad "late title moves the window on to workspace $WS_SPECIFIC" \
            "it is on workspace index $actual, expected $((WS_SPECIFIC - 1))"
    fi
    window_log=$(logs_since "$start")
    if echo "$window_log" | grep -q '\[check-refine\] -> workspace '"$WS_GENERIC"' (created, provisional)'; then
        ok "it is parked on workspace $WS_GENERIC first, not left on the current one"
    else
        bad "it is parked on workspace $WS_GENERIC first, not left on the current one" \
            "expected a '(created, provisional)' line for check-refine"
    fi
    refine_line=$(echo "$window_log" | grep '\[check-specific\] -> workspace '"$WS_SPECIFIC" | head -1)
    if [ -n "$refine_line" ] && ! echo "$refine_line" | grep -q '(deadline)'; then
        ok "the refinement fires on a window signal, before the deadline"
    else
        bad "the refinement fires on a window signal, before the deadline" \
            "expected a pre-deadline refinement, got: ${refine_line:-no refinement line at all}"
    fi
fi
close_class "$CLASS_REFINE"

printf 'window that matches nothing\n'
start=$(date +%s)
spawn "$CLASS_IGNORED" 'printf "\033]0;ignored\007"; sleep 8'
if ! wait_for_window "$CLASS_IGNORED" >/dev/null; then
    bad "unmatched window is left where it opened" "window never appeared"
else
    opened_on=$(window_workspace "$CLASS_IGNORED")
    sleep 3.5
    actual=$(window_workspace "$CLASS_IGNORED")
    if [ -n "$opened_on" ] && [ "$actual" = "$opened_on" ]; then
        ok "unmatched window stays where it opened (workspace index $opened_on)"
    else
        bad "unmatched window stays where it opened" \
            "it opened on workspace index ${opened_on:-unknown} and is now on ${actual:-unknown}"
    fi
    if logs_since "$start" | grep -q 'no rule can match, leaving in place'; then
        ok "the decision is taken at once, without waiting for the deadline"
    else
        bad "the decision is taken at once, without waiting for the deadline" \
            "expected a 'no rule can match' line"
    fi
fi
close_class "$CLASS_IGNORED"

printf 'volatile predicate that never comes true\n'
wmctrl -s "$WS_START" 2>/dev/null || true
sleep 0.5
start=$(date +%s)
spawn "$CLASS_STALE" 'printf "\033]0;stale\007"; sleep 12'
if ! wait_for_window "$CLASS_STALE" >/dev/null; then
    bad "window is finalized once the deadline expires" "window never appeared"
else
    stale_id=$(normalize_id "$(window_id "$CLASS_STALE")")
    sleep 4
    window_log=$(logs_since "$start")
    if echo "$window_log" | grep -q '\[check-stale\] -> workspace '"$WS_GENERIC"' (created, provisional)'; then
        ok "it is parked on workspace $WS_GENERIC while the title is still pending"
    else
        bad "it is parked on workspace $WS_GENERIC while the title is still pending" \
            "expected a '(created, provisional)' line for check-stale"
    fi
    if echo "$window_log" | grep -q '\[check-stale\] confirmed on workspace '"$WS_GENERIC"' (deadline)'; then
        ok "the deadline finalizes it on the generic rule without moving it again"
    else
        bad "the deadline finalizes it on the generic rule without moving it again" \
            "expected '[check-stale] confirmed on workspace $WS_GENERIC (deadline)'"
    fi
    actual=$(current_workspace)
    if [ "$actual" = "$((WS_GENERIC - 1))" ]; then
        ok "follow switched the session to workspace $WS_GENERIC"
    else
        bad "follow switched the session to workspace $WS_GENERIC" \
            "the active workspace index is ${actual:-unknown}, expected $((WS_GENERIC - 1))"
    fi
    active=$(active_window_id)
    if [ -n "$stale_id" ] && [ "$active" = "$stale_id" ]; then
        ok "focus activated the window itself"
    else
        bad "focus activated the window itself" \
            "the active window is ${active:-unknown}, expected ${stale_id:-unknown}"
    fi
fi
close_class "$CLASS_STALE"

printf 'snapshot over D-Bus\n'
snapshot=$(gdbus call --session --dest "$DBUS_NAME" --object-path "$DBUS_PATH" \
    --method "$DBUS_NAME.ListWindows" 2>&1)
if echo "$snapshot" | grep -q '"workspace"'; then
    ok "ListWindows returns the open windows with their workspace"
else
    bad "ListWindows returns the open windows with their workspace" \
        "gdbus said: $snapshot"
fi
if echo "$snapshot" | grep -q '"appId"' && echo "$snapshot" | grep -q '"wmClass"'; then
    ok "the snapshot carries the fields the matcher uses"
else
    bad "the snapshot carries the fields the matcher uses" \
        "expected appId and wmClass in the reply"
fi

printf '\n'
if [ "$failed" -gt 0 ]; then
    printf '%d of %d live checks failed\n' "$failed" "$((passed + failed))"
    exit 1
fi
printf 'all %d live checks passed\n' "$passed"
