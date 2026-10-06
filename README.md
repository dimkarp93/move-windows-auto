# move-windows-auto: руководство разработчика

Расширение GNOME Shell, которое раскладывает окна по workspace по правилам над свойствами окна (заголовок, `WM_CLASS`, роль, тип, геометрия, монитор, командная строка процесса).

Руководство пользователя (настройка, правила, примеры): [usage.md](usage.md). Состав проверок: [CHECKS.md](CHECKS.md). Сборка пакета и публикация: [publish.md](publish.md).

## Содержание

1. [Совместимость](#совместимость)
2. [Зависимости](#зависимости)
3. [Структура репозитория](#структура-репозитория)
4. [Установка](#установка)
5. [Запуск версии из репозитория](#запуск-версии-из-репозитория)
6. [Рецепты just](#рецепты-just)
7. [Основные модули и команды](#основные-модули-и-команды)
8. [Как работает расширение](#как-работает-расширение)
9. [Отладка](#отладка)
10. [Тесты и CI](#тесты-и-ci)
11. [Публикация](#публикация)
12. [Ограничения](#ограничения)

## Совместимость

| Дистрибутив | GNOME Shell | Сборка | Формат расширения |
|---|---|---|---|
| Debian 12 «bookworm» | 43 | `legacy43` | legacy `imports.*` |
| Debian 13 «trixie» | 48 | `esm48` | ES-модули |

Загрузчики расширений до GNOME 45 и после несовместимы, поэтому из одного исходника собираются два пакета: `legacy43` (`shell-version` 43, 44) и `esm48` (45–48). Протестированы только 43 и 48; 44 и 45–47 указаны, так как используют тот же набор API. GNOME 49+ не заявлен.

Работает в X11 и Wayland. Отличия Wayland описаны в [ограничениях](#ограничения).

## Зависимости

### Для запуска расширения

- GNOME Shell 43–48 (`gnome-shell`).
- libadwaita 1.2+ и GTK 4 для окна настроек (идут с GNOME 43 и новее).
- Утилита `gnome-extensions` (входит в пакет `gnome-shell`).

### Для сборки и проверок (`just build`, `just test`, `just pack`)

| Пакет | Для чего | Debian |
|---|---|---|
| `bash` | скрипты проверок | есть по умолчанию |
| `gjs` | запуск тестов без shell (1.74 в Debian 12, 1.84 в Debian 13) | `gjs` |
| `zip`, `unzip` | сборка архива и список его содержимого в `just pack` | `zip unzip` |
| `just` ≥ 1.27 | запуск рецептов (нужны группы рецептов и атрибут `doc`) | в Debian 13: `just`; в Debian 12 пакета нет, ставится с [github.com/casey/just](https://github.com/casey/just) |

### Для линтера (`just lint`)

`nodejs` и `npm` (ESLint 9 ставится в `node_modules` из `package.json`, при первом запуске нужна сеть). Расширению Node.js не нужен.

### Для локальной разработки и диагностики

| Пакет | Для чего |
|---|---|
| `gnome-extensions`, `gdbus` (`libglib2.0-bin`), `journalctl` (`systemd`) | `install`, `status`, `prefs`, `windows`, `logs` |
| `gjs` | `tools/mwa.js`: `dev` (включение при первой установке), `inspect`, `add-rule`, `debug`, `doctor` |
| `dbus-send` (`dbus-bin` или `dbus`) | `restart` |
| `xprop`, `xwininfo` (`x11-utils`) | `inspect` в X11 |
| `wmctrl`, `kitty`, `xprop` | только `just live` (X11) |

```sh
sudo apt install bash gjs zip unzip git x11-utils libglib2.0-bin
```

## Структура репозитория

```
src/lib/          общий код: matcher, rules, config, suggest, mover, placer, dbus, ui, prefs_*
src/legacy/       extension.js, prefs.js, metadata.json для GNOME Shell 43–44
src/esm/          extension.js, prefs.js, metadata.json для GNOME Shell 45–48
rules.default.json  набор правил по умолчанию (копируется в конфиг при первом запуске)
tools/build.sh    сборка build/{legacy43,esm48} и zip-архивов в dist/
tools/mwa.js      вспомогательные команды на gjs: окна по D-Bus, заготовка и добавление правила, debug, проверка конфига
tools/cli.js      логика tools/mwa.js без ввода-вывода (покрыта tests/cli.js)
tests/            проверки (см. CHECKS.md)
bin/mwa-inspect   поля окна в фокусе и заготовка правила
bin/mwa-add-rule  добавить правило для окна в фокусе в rules.json
justfile          все рецепты
build/, dist/     генерируются, в git не хранятся
```

**Исходник один**: `src/lib/*.js` написан как ES-модули. Сборщик копирует его как есть в `build/esm48`, а для `build/legacy43` переписывает строгими правилами (`import` → `imports.*`, `export` → `var`/функции). Любая неизвестная форма `import`/`export` — ошибка сборки. Всё, что различается между версиями shell (`Main`, путь расширения, `log`), передаётся из точек входа в `Controller` (`src/lib/mover.js`), поэтому логика не раздваивается.

После правки `src/` перед запуском в shell нужна пересборка: `just build` (или `just reload`), потому что симлинк указывает на `build/`.

## Установка

### Из исходников (рекомендуется для разработки)

```sh
git clone https://github.com/dimkarp93/move-windows-auto.git
cd move-windows-auto
just dev
```

`just dev` выполняет `test`, `install`, `seed-config`, включение расширения и `restart`:

- собирает обе версии и линкует подходящую (`build/legacy43` или `build/esm48`, выбирается по `gnome-shell --version`) в `~/.local/share/gnome-shell/extensions/move-windows-auto@dimkarp93`;
- создаёт `~/.config/move-windows-auto/rules.json` из `rules.default.json`, если файла нет;
- **отключает штатное `auto-move-windows`** и включает это расширение;
- перезапускает shell.

`install` отказывается заменять настоящий каталог на месте симлинка. Если вы ставили расширение вручную, удалите его.

Перезапуск shell: на X11 `restart` пробует сделать это через D-Bus (нужен unsafe-mode), иначе подсказывает `Alt+F2`, `r`, `Enter`. На Wayland перезапуск невозможен, нужен перелогин.

### Из готового архива

`just pack` собирает два архива в `dist/`:

```sh
# Debian 12 (GNOME Shell 43)
gnome-extensions install --force dist/move-windows-auto@dimkarp93.legacy43.shell-extension.zip
# Debian 13 (GNOME Shell 48)
gnome-extensions install --force dist/move-windows-auto@dimkarp93.esm48.shell-extension.zip
```

Затем перелогин или перезапуск shell и `gnome-extensions enable move-windows-auto@dimkarp93`. Штатное `auto-move-windows` отключается вручную.

## Запуск версии из репозитория

```sh
just dev          # первая установка
just reload       # после правок src/: test + restart; на Wayland вместо restart нужен перелогин
```

Минимальный цикл без перезапуска shell: правки в `rules.json` применяются кнопкой «Сохранить» в окне настроек или вызовом D-Bus-метода `Reload`, правки кода требуют перезапуска shell, потому что GNOME Shell не выгружает JS-модули расширений.

Проверить, что запустилась именно версия из репозитория:

```sh
just status                                   # расширение включено, нет ошибок загрузки
readlink ~/.local/share/gnome-shell/extensions/move-windows-auto@dimkarp93   # → .../build/<flavour>
just doctor                                   # версия shell, выбранная сборка, окна
```

Окно настроек можно открыть отдельно от shell: `just prefs`. Оно выполняется отдельным процессом, перезапуск shell для него не нужен, но после правки кода окно надо закрыть и открыть заново.

## Рецепты just

Список по группам выводит `just` без аргументов. Группы требуют `just` ≥ 1.27.

### 1. Сборка и упаковка

| Рецепт | Назначение |
|---|---|
| `just build` | собрать `build/legacy43` и `build/esm48` |
| `just bump-version [URL]` | поднять `version` в обоих `metadata.json` и обновить `url` (по умолчанию из `origin`), закоммитить их, поставить тег `vN` и опубликовать тег в `origin`; `--no-git` без коммита и тега, `--keep-version` не трогает версию и git |
| `just pack` | после `lint` и `test` собрать zip обеих версий в `dist/` |

### 2. Проверка

| Рецепт | Назначение |
|---|---|
| `just lint` | ESLint (`no-undef` и др.) по `src/`, `tests/` и `tools/`; нужна сеть для `npm install` |
| `just test` | сборка и проверки без shell: обе сборки, матчер, валидация, логика окна настроек, разбор файлов, `bash -n` |
| `just live` | проверки на живой X11-сессии; создаёт и закрывает свои окна, подменяет `rules.json` и восстанавливает его |
| `just verify` | `test`, затем `live` |

### 3. Локальная разработка

| Рецепт | Назначение |
|---|---|
| `just dev` | `test`, `install`, `seed-config`, включение, `restart` |
| `just reload` | `test` и `restart` после правок в `src/` |
| `just install` / `just uninstall` | симлинк подходящей сборки в каталог расширений / отключение и удаление (симлинк снимается, установка из zip удаляется через `gnome-extensions uninstall`) |
| `just seed-config` | создать `rules.json` из `rules.default.json`, если его нет |
| `just restart` | перезапустить shell (X11 с unsafe-mode) |
| `just prefs` | открыть окно настроек |
| `just status` | состояние расширения (`gnome-extensions info`) |
| `just doctor` | отчёт об окружении: версия shell, сессия, сборка, конфиг, таблица окон |
| `just windows` | сырой список всех окон от расширения по D-Bus |
| `just inspect [-d N] [-b] [-i ID]` | поля одного окна и заготовка правила |
| `just debug on\|off` | включить или выключить `"debug"` в `rules.json` |
| `just logs` | следить за журналом (строки `MWA`) |

Отдельных рецептов `enable` и `disable` нет: `dev` включает расширение сам, `uninstall` отключает. Вручную: `gnome-extensions enable move-windows-auto@dimkarp93`.

### Чем `windows` отличается от `inspect`

| | `just windows` | `just inspect` |
|---|---|---|
| Что показывает | **все** открытые окна (кроме закреплённых на всех workspace и не попадающих в панель задач) | **одно** окно: то, что в фокусе |
| Формат | сырой JSON внутри строки GVariant, для машины | читаемый отчёт и готовый блок `match` для `rules.json` |
| Источник | расширение по D-Bus (`ListWindows`) | X11: `xprop`/`xwininfo`; Wayland или флаг `-b`: то же, что у `windows` |
| Нужно расширение | да, включённое | на X11 нет, на Wayland да |
| Содержит `workspace`, `id`, `focused` | да | выводит workspace и id в режиме D-Bus |
| Зачем | убедиться, что расширение отвечает; сравнить значения у разных окон; отладка | написать правило для конкретного окна |

Коротко: `windows` отвечает на вопрос «что расширение видит у всех окон», `inspect` — «какое правило написать для этого окна».

Пример:

```sh
just windows
# ('[{"appId":"code.desktop","wmClass":"code",...,"workspace":2,"focused":true}, ...]',)

just inspect -d 3          # за 3 с переключитесь на нужное окно
# observed window 0x4a00007
#   wmClass          code
#   title            main.js - containers - Visual Studio Code
# rule skeleton, drop the predicates you do not need:
#     { "name": "CHANGE-ME", "match": { "wmClass": "^code$", "title": "..." }, "workspace": 1 }
```

Флаги `inspect`: `-d СЕКУНДЫ` — пауза перед чтением; `-i ID` — окно X11 по идентификатору; `-b` — принудительно через D-Bus (по умолчанию в Wayland).

## Основные модули и команды

### Модули (`src/lib`)

| Модуль | Зависит от shell | Назначение |
|---|---|---|
| `matcher.js` | нет | предикаты, деление на стабильные и изменчивые, `evaluate` и `resolve` |
| `rules.js` | нет | разбор и проверка конфига, компиляция regex и диапазонов |
| `config.js` | нет | чтение, запись, слияние правил, путь `~/.config/move-windows-auto/rules.json` |
| `suggest.js` | нет | предложение правил по снимку окон (страница «Снимок») |
| `prefs_model.js` | нет | логика окна настроек без виджетов: диапазоны, regex с флагами, перестановка правил |
| `dbus.js` | нет | имя, путь и XML интерфейса `org.gnome.Shell.Extensions.MoveWindowsAuto` |
| `placer.js` | да (`Meta`) | перенос окна на workspace и монитор, `follow` и `focus` |
| `mover.js` | да (`Meta`, `Shell`) | `Controller`: ожидание заголовка, подписки на окна, D-Bus-сервис |
| `ui.js`, `prefs_rules.js`, `prefs_snapshot.js`, `prefs_window.js` | нет (Gtk, Adw) | окно настроек |

Всё, что помечено «нет», выполняется в обычном `gjs` и покрыто `just test`.

### D-Bus

Интерфейс `org.gnome.Shell.Extensions.MoveWindowsAuto`, путь `/org/gnome/Shell/Extensions/MoveWindowsAuto`, метод `ListWindows` возвращает JSON-строку с массивом окон. Каждое окно содержит поля матчера (`appId`, `wmClass`, `wmClassInstance`, `role`, `gtkAppId`, `windowType`, `cmdline`, `title`, `x`, `y`, `width`, `height`, `maximized`, `monitor`) плюс `id`, `workspace` и `focused`. Интерфейс регистрируется при включении расширения и снимается при выключении. Окно настроек исполняется отдельным процессом без доступа к `Meta` и `Shell`, поэтому снимок берёт именно так.

```sh
gdbus call --session --dest org.gnome.Shell.Extensions.MoveWindowsAuto \
    --object-path /org/gnome/Shell/Extensions/MoveWindowsAuto \
    --method org.gnome.Shell.Extensions.MoveWindowsAuto.ListWindows
```

### Полезные команды GNOME

```sh
gnome-shell --version
gnome-extensions list --enabled
gnome-extensions info move-windows-auto@dimkarp93
gnome-extensions prefs move-windows-auto@dimkarp93
journalctl --user -f -o cat | grep MWA
```

## Как работает расширение

На момент создания окна заголовок часто не финален: у многих приложений он сначала содержит лишь имя программы, а проект или документ появляются через сотни миллисекунд. Идентифицировать окно по процессу нельзя: окна одного приложения живут в одном процессе, у single-instance приложений `cmdline` относится к первому запуску.

Поэтому предикаты делятся на два класса:

- **стабильные** известны сразу: `wmClass`, `wmClassInstance`, `role`, `gtkAppId`, `windowType`, `cmdline`;
- **изменчивые** могут поменяться: `title`, `x`, `y`, `width`, `height`, `maximized`, `monitor`, а также `appId` до того, как GNOME сопоставит окно приложению.

При каждом изменении окна (`notify::title`, `size-changed`, резолв приложения) считается:

```
firstMatch    = первое правило, совпавшее целиком
firstPossible = первое правило, где стабильная часть совпала, а изменчивая пока нет

firstMatch есть И (firstPossible нет ИЛИ firstMatch выше)  → применить, готово
firstMatch нет И firstPossible нет                          → окно не трогать
иначе                                                       → перенести по firstMatch и ждать дальше
```

Третья ветвь: окно переносится по лучшему из уже совпавших правил **немедленно**, а не остаётся на чужом workspace, пока не придёт заголовок. Если за `settleMs` (по умолчанию 2500 мс, не меньше 2000 мс) подошло более специфичное правило, следует второй перенос. `follow` и `focus` выполняются только при финальном переносе, чтобы фокус не переключался дважды. Если за `settleMs` ничего не изменилось, предварительный перенос становится окончательным. Окно, для которого нет подходящих правил, остаётся там, где открылось.

Конфиг `~/.config/move-windows-auto/rules.json` перечитывается только по явной команде: кнопка «Сохранить» в окне настроек вызывает D-Bus-метод `Reload`. За файлом расширение не следит. При ошибке разбора прежние правила остаются.

## Отладка

### Журнал расширения

```sh
just debug on     # "debug": true в rules.json, затем `gdbus call --session --dest org.gnome.Shell.Extensions.MoveWindowsAuto --object-path /org/gnome/Shell/Extensions/MoveWindowsAuto --method org.gnome.Shell.Extensions.MoveWindowsAuto.Reload`
just logs         # journalctl --user -f -o cat | grep MWA
just debug off
```

В журнале видны новое окно со всеми полями, сработавшее правило и шаг, на котором это произошло:

```
MWA: window created {"appId":"example-app.desktop","wmClass":"example-app",...,"title":"Example App"}
MWA: [app] -> workspace 1 (created, provisional)
MWA: waiting up to 2500ms for [app-special-window] on: title
MWA: [app-special-window] -> workspace 4 (notify::title)
MWA: [app-special-window] confirmed on workspace 4 (deadline)
```

`provisional` — предварительный перенос; `confirmed` — окончание ожидания. Без `debug` в журнал попадают только ошибки (сломанный конфиг, недоступный D-Bus, несуществующий workspace или монитор) и строка `loaded N rules` при загрузке конфига.

В GNOME 43 расширение пишет через `log()`, в 45+ через `console.log()`: в обоих случаях строки с префиксом `MWA` видны в `journalctl --user`.

### Ошибки загрузки расширения

```sh
just status                 # State, Error, если расширение не загрузилось
journalctl --user -b | grep -iE "move-windows-auto|MWA|JS ERROR"
```

В Wayland GNOME Shell запускается один раз за сессию, поэтому ошибки при загрузке видны только после перелогина. В X11 `Alt+F2`, `r` перезапускает shell, а журнал смотрится так же.

Типичные причины: нет файла `metadata.json` или не совпадает `shell-version` (расширение не появляется в списке), синтаксическая ошибка в `build/` (попробуйте `just test`), установлена не та сборка (сравните `just doctor` и `readlink` на каталог расширения).

### Окно настроек

Выполняется отдельным процессом. Чтобы увидеть его ошибки, запустите из терминала:

```sh
gnome-extensions prefs move-windows-auto@dimkarp93
```

Сообщения `JS ERROR` пойдут в этот терминал. Проверка «Снимок» требует работающего расширения: `just windows` должен отвечать.

### Когда правило не срабатывает

1. `just debug on` и `just logs`.
2. Сравнить строку `window created {...}` с `match` правила. Типичные ошибки: перепутаны `wmClass` и `wmClassInstance`; в regex не экранированы `.` и `-`; в JSON одна косая вместо двух.
3. `just inspect -d 3` (или `just windows`), чтобы увидеть значения глазами расширения.
4. Если окно переносится с задержкой: в одном из правил только изменчивые предикаты (например, одна геометрия). Такое правило остаётся «возможным» для любого окна и вынуждает ждать `settleMs`. Добавьте в него `wmClass` или `appId`.
5. Окно без `.desktop`-файла при наличии правил по `appId` тоже ждёт `settleMs`: пока приложение не определено, такие правила остаются «возможными».

### Отладка кода

- Логика без shell: `gjs -m tests/run.js` (оба варианта сборки).
- Любую функцию из `matcher`, `rules`, `suggest`, `config` можно вызвать из `gjs -m` и проверить на фикстуре окна, не трогая shell.
- Код, которому нужны `Meta` и `Shell` (`mover.js`, `placer.js`), в тестах не выполняется. Для него есть `just lint` (необъявленные имена) и `just live` (реальный Mutter).

## Тесты и CI

```sh
just test      # всё, что не требует shell
just lint      # ESLint
just live      # реальная X11-сессия (создаёт окна kitty и подменяет rules.json)
just verify    # test + live
```

`just test` требует только `bash` и `gjs`. Один и тот же набор проверок прогоняется дважды: по ES-модулям из `src/lib` и по сгенерированной legacy-сборке, поэтому ошибка автоматического переписывания не остаётся незамеченной. Дополнительно проверяется, что обе сборки разбираются, не смешивают системы модулей и объявляют непересекающиеся диапазоны `shell-version` (с 43 и 48). Подробнее: [CHECKS.md](CHECKS.md).

`.github/workflows/ci.yml`:

- `test` в контейнерах `debian:12` и `debian:13` со штатным `gjs` этих дистрибутивов (`bash tests/all.sh`);
- `lint` (ESLint на Node 22);
- `package` собирает zip и выкладывает как артефакт;
- по тегу `v*` архивы публикуются в релиз GitHub.

Workflow на GitHub не запускался. Набор `tests/all.sh` проверен локально на gjs 1.74.2 (Debian 12).

## Публикация

Подробно: [publish.md](publish.md).

- **Сборка.** `just pack` (после `lint` и `test`) кладёт в `dist/` два архива: `move-windows-auto@dimkarp93.legacy43.shell-extension.zip` (GNOME Shell 43, 44) и `move-windows-auto@dimkarp93.esm48.shell-extension.zip` (45–48). Перед сборкой выполните `just bump-version`: он поднимает `version` в обоих `metadata.json`, подставляет в `url` адрес `origin`, коммитит, ставит тег `vN` и пушит тег в `origin`, что запускает релиз в CI.
- **Файлом.** По тегу `v*` CI прикладывает архивы к релизу GitHub. Установка: `gnome-extensions install --force <архив>`, затем перезапуск shell или перелогин и `gnome-extensions enable move-windows-auto@dimkarp93`.
- **Каталог extensions.gnome.org.** Оба архива загружаются на [extensions.gnome.org/upload](https://extensions.gnome.org/upload/) под одним `uuid`, дальше идёт ручная проверка по [Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html). Пользователи ставят расширение со страницы каталога и получают обновления автоматически.

## Ограничения

- GNOME Shell 43–48; 49+ не заявлен. Протестированы 43 и 48.
- Код, исполняемый внутри shell (`mover.js`, `placer.js`, точки входа), и окно настроек вне shell автоматически не проверяются; загрузка в GNOME 48 и Wayland проверяется вручную.
- `just live` и режим `inspect` через `xprop` работают только на X11.
- В Wayland нет свойств X11: `role` у нативных окон пуст, `wmClassInstance` может совпадать с `wmClass` или отсутствовать; опирайтесь на `appId` и `wmClass`. `just doctor` покажет реальные значения.
- Заголовки окон локализованы: правила по тексту должны перечислять все языковые варианты.
- Совпадение по заголовку нестрогое: окно, случайно содержащее нужный текст, тоже подойдёт.
- Workspace нумеруются с 1. Поддерживается только фиксированное число workspace: расширение их не создаёт, правило с номером больше их числа не применяется (в журнал пишется предупреждение). При динамических workspace срабатывают только правила на уже существующие.
- Окно может переноситься дважды: сначала по общему правилу, затем по специфичному. Это цена быстрого переноса.
