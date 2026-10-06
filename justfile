uuid := "move-windows-auto@dimkarp93"
legacy_uuid := "auto-move-windows@gnome-shell-extensions.gcampax.github.com"
root := justfile_directory()
flavour := `v=$(gnome-shell --version 2>/dev/null | grep -o '[0-9][0-9]*' | head -1); if [ -n "$v" ] && [ "$v" -lt 45 ]; then echo legacy43; else echo esm48; fi`
target := env_var('HOME') / ".local/share/gnome-shell/extensions" / uuid
config_dir := env_var('HOME') / ".config/move-windows-auto"
config := config_dir / "rules.json"

[private]
default:
    @just --list --unsorted

[group('1. Сборка и упаковка')]
[doc('Собрать build/legacy43 и build/esm48 из src/')]
build:
    @sh {{root}}/tools/build.sh

[group('1. Сборка и упаковка')]
[doc('Поднять version в обоих metadata.json и обновить url: just bump-version [URL] [--no-git] [--keep-version]; коммит, тег vN и push тега в origin')]
bump-version *args:
    @sh {{root}}/tools/bump-version.sh {{args}}

[group('1. Сборка и упаковка')]
[doc('Собрать zip обеих версий в dist/ (после lint и test)')]
pack: lint test
    #!/usr/bin/env bash
    set -euo pipefail
    sh "{{root}}/tools/build.sh" --pack
    for zip in "{{root}}"/dist/*.shell-extension.zip; do
        echo "$zip"
        unzip -l "$zip"
    done

[group('2. Проверка')]
[doc('ESLint по src/, tests/ и tools/; один раз нужна сеть для npm install')]
lint:
    @cd {{root}} && npm install --no-audit --no-fund --silent && npx eslint src tests tools

[group('2. Проверка')]
[doc('Сборка и все проверки без gnome-shell (нужны только bash, gjs)')]
test:
    @bash {{root}}/tests/all.sh

[group('2. Проверка')]
[doc('Проверки на живой X11-сессии; создаёт и закрывает свои окна')]
live:
    @bash {{root}}/tests/live.sh

[group('2. Проверка')]
[doc('test, затем live')]
verify: test live

[group('3. Локальная разработка')]
[doc('Поставить и включить расширение: test, install, seed-config, включение, restart')]
dev: test install seed-config _enable restart

[group('3. Локальная разработка')]
[doc('Пересобрать, проверить и перезапустить shell')]
reload: test restart

[group('3. Локальная разработка')]
[doc('Собрать и слинковать нужную версию в каталог расширений GNOME')]
install: build
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -e "{{target}}" ] && [ ! -L "{{target}}" ]; then
        echo "refusing to replace real directory {{target}}" >&2
        exit 1
    fi
    mkdir -p "$(dirname "{{target}}")"
    ln -sfn "{{root}}/build/{{flavour}}" "{{target}}"
    echo "linked {{target}} -> {{root}}/build/{{flavour}}"

[group('3. Локальная разработка')]
[doc('Отключить и удалить расширение: снять симлинк или удалить установку из zip')]
uninstall:
    #!/usr/bin/env bash
    set -euo pipefail
    gnome-extensions disable "{{uuid}}" 2>/dev/null || true
    if [ -L "{{target}}" ]; then
        rm "{{target}}"
        echo "removed link {{target}}"
    elif [ -d "{{target}}" ]; then
        gnome-extensions uninstall "{{uuid}}"
        echo "uninstalled {{target}}"
    else
        echo "{{uuid}} is not installed in {{target}}"
        exit 0
    fi
    echo "the code stays loaded until gnome-shell restarts: Alt+F2, r on X11, log out and in on Wayland"

[group('3. Локальная разработка')]
[doc('Создать ~/.config/move-windows-auto/rules.json, если его нет')]
seed-config:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -e "{{config}}" ]; then
        echo "keeping existing {{config}}"
    else
        mkdir -p "{{config_dir}}"
        cp "{{root}}/rules.default.json" "{{config}}"
        echo "created {{config}}"
    fi

[private]
_enable:
    #!/usr/bin/env bash
    set -euo pipefail
    if gnome-extensions list --enabled | grep -qx "{{legacy_uuid}}"; then
        gnome-extensions disable "{{legacy_uuid}}"
        echo "disabled {{legacy_uuid}}"
    fi
    if gnome-extensions enable "{{uuid}}" 2>/dev/null; then
        echo "enabled {{uuid}}"
    else
        gjs -m "{{root}}/tools/mwa.js" enable "{{uuid}}"
    fi

[group('3. Локальная разработка')]
[doc('Перезапустить gnome-shell (только X11 с unsafe-mode)')]
restart:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ "${XDG_SESSION_TYPE:-}" = "wayland" ]; then
        echo "Wayland session: log out and back in to reload the shell." >&2
        exit 1
    fi
    reply=$(dbus-send --session --dest=org.gnome.Shell --type=method_call \
        --print-reply /org/gnome/Shell org.gnome.Shell.Eval \
        string:'Meta.restart("Reloading…")' 2>/dev/null || true)
    if echo "$reply" | grep -q 'boolean true'; then
        echo "gnome-shell restarted"
    else
        echo "Cannot restart automatically: org.gnome.Shell.Eval is disabled without unsafe-mode."
        echo "Press Alt+F2, type  r  and hit Enter to reload gnome-shell."
        exit 1
    fi

[group('3. Локальная разработка')]
[doc('Открыть окно настроек')]
prefs:
    @gnome-extensions prefs "{{uuid}}"

[group('3. Локальная разработка')]
[doc('Снимок открытых окон по D-Bus')]
windows:
    @gdbus call --session --dest org.gnome.Shell.Extensions.MoveWindowsAuto \
        --object-path /org/gnome/Shell/Extensions/MoveWindowsAuto \
        --method org.gnome.Shell.Extensions.MoveWindowsAuto.ListWindows

[group('3. Локальная разработка')]
[doc('Поля окна и заготовка правила: just inspect -d 3')]
inspect *args:
    @{{root}}/bin/mwa-inspect {{args}}

[group('3. Локальная разработка')]
[doc('Добавить правило для окна в rules.json: just add-rule NAME WORKSPACE -d 3 [-f FILE] [-t]')]
add-rule name workspace *args:
    @{{root}}/bin/mwa-add-rule -n "{{name}}" -w "{{workspace}}" {{args}}

[group('3. Локальная разработка')]
[doc('Состояние расширения')]
status:
    @gnome-extensions info "{{uuid}}" || true

[group('3. Локальная разработка')]
[doc('Отчёт об окружении и таблица открытых окон')]
doctor:
    @bash {{root}}/tests/env-report.sh

[group('3. Локальная разработка')]
[doc('Следить за журналом расширения (строки MWA)')]
logs:
    @journalctl --user -f -o cat | grep --line-buffered MWA

[group('3. Локальная разработка')]
[doc('Включить или выключить отладочный журнал: just debug on|off')]
debug on_off="on":
    @gjs -m {{root}}/tools/mwa.js debug {{on_off}}
