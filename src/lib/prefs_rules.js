import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import * as Config from './config.js';
import * as Matcher from './matcher.js';
import * as Model from './prefs_model.js';
import * as Rules from './rules.js';
import * as Ui from './ui.js';

const {MAX_WORKSPACE} = Model;

export class RulesPage {
    constructor(store) {
        this._store = store;
        this._expanded = new Set();

        this.page = new Adw.PreferencesPage({
            title: 'Правила',
            icon_name: 'view-list-symbolic',
        });

        this._buildFileGroup();
        this._buildGeneralGroup();

        this._rulesGroup = new Adw.PreferencesGroup({title: 'Правила'});
        this._rulesGroup.set_header_suffix(Ui.iconButton('list-add-symbolic',
            'Добавить правило', () => this._addRule()));
        this.page.add(this._rulesGroup);

        this._rows = [];
        this.refresh();

        store.onChanged(() => this.refresh());
        store.onDirty(() => this._syncButtons());
    }

    _buildFileGroup() {
        let group = new Adw.PreferencesGroup({
            title: 'Файл настроек',
            description: Config.CONFIG_PATH,
        });

        let box = new Gtk.Box({spacing: 6, valign: Gtk.Align.CENTER});

        this._saveButton = new Gtk.Button({
            label: 'Сохранить',
            sensitive: false,
            css_classes: ['suggested-action'],
        });
        this._saveButton.connect('clicked', () => this._store.save());
        box.append(this._saveButton);

        this._resetButton = new Gtk.Button({label: 'Сбросить', sensitive: false});
        this._resetButton.connect('clicked', () => this._store.revert());
        box.append(this._resetButton);

        let menu = new Gio.Menu();
        menu.append('Импорт…', 'prefs.import');
        menu.append('Экспорт…', 'prefs.export');

        let menuButton = new Gtk.MenuButton({
            icon_name: 'view-more-symbolic',
            menu_model: menu,
            css_classes: ['flat'],
        });
        box.append(menuButton);

        group.set_header_suffix(box);
        this.page.add(group);
    }

    _buildGeneralGroup() {
        this._generalGroup = new Adw.PreferencesGroup({title: 'Общие'});
        this.page.add(this._generalGroup);
        this._generalRows = [];
    }

    _refreshGeneral() {
        for (let row of this._generalRows)
            this._generalGroup.remove(row);
        this._generalRows = [];

        let raw = this._store.raw;

        let settle = Ui.spinRow('Задержка распознавания, мс', {
            min: Rules.MIN_SETTLE_MS,
            max: 10000,
            step: 100,
            value: raw.settleMs === undefined ? Rules.DEFAULT_SETTLE_MS : Math.max(raw.settleMs, Rules.MIN_SETTLE_MS),
            subtitle: 'сколько ждать финального заголовка окна',
            onChange: value => {
                raw.settleMs = value;
                this._store.markDirty();
            },
        });

        let debug = Ui.switchRow('Отладочный журнал', raw.debug === true, value => {
            raw.debug = value;
            this._store.markDirty();
        }, 'journalctl --user -f -o cat | grep MWA');

        for (let row of [settle.row, debug.row]) {
            this._generalGroup.add(row);
            this._generalRows.push(row);
        }
    }

    _syncButtons() {
        this._saveButton.sensitive = this._store.dirty;
        this._resetButton.sensitive = this._store.dirty;
    }

    refresh() {
        this._syncButtons();

        for (let row of this._rows)
            this._rulesGroup.remove(row);
        this._rows = [];

        this._refreshGeneral();

        let rules = this._store.rules();

        if (rules.length === 0) {
            let empty = new Adw.ActionRow({
                title: 'Правил нет',
                subtitle: 'добавьте правило вручную или снимите текущее состояние сессии',
            });
            this._rulesGroup.add(empty);
            this._rows.push(empty);
            return;
        }

        rules.forEach((rule, index) => {
            let row = this._buildRuleRow(rule, index);
            this._rulesGroup.add(row);
            this._rows.push(row);
        });
    }

    _buildRuleRow(rule, index) {
        let row = new Adw.ExpanderRow({
            title: Model.ruleTitle(rule, index),
            subtitle: Config.describeRule(rule),
            expanded: this._expanded.has(index),
        });

        row.connect('notify::expanded', () => {
            if (row.expanded)
                this._expanded.add(index);
            else
                this._expanded.delete(index);
        });

        row.add_action(Ui.iconButton('go-up-symbolic', 'Выше',
            () => this._move(index, -1)));
        row.add_action(Ui.iconButton('go-down-symbolic', 'Ниже',
            () => this._move(index, 1)));
        row.add_action(Ui.iconButton('edit-copy-symbolic', 'Дублировать',
            () => this._duplicate(index)));
        row.add_action(Ui.iconButton('user-trash-symbolic', 'Удалить',
            () => this._remove(index)));

        let nameRow = Ui.entryRow('Название', rule.name || '', text => {
            rule.name = text;
            row.title = Model.ruleTitle(rule, index);
            this._store.markDirty(false);
        });
        row.add_row(nameRow);

        let workspace = Ui.spinRow('Workspace', {
            min: 1,
            max: MAX_WORKSPACE,
            value: rule.workspace || 1,
            onChange: value => {
                rule.workspace = value;
                row.subtitle = Config.describeRule(rule);
                this._store.markDirty(false);
            },
        });
        row.add_row(workspace.row);

        let monitor = Ui.spinRow('Монитор', {
            min: -1,
            max: 8,
            value: rule.monitor === undefined || rule.monitor === null ? -1 : rule.monitor,
            subtitle: '-1 — не переносить между мониторами',
            onChange: value => {
                Model.setMonitor(rule, value);
                row.subtitle = Config.describeRule(rule);
                this._store.markDirty(false);
            },
        });
        row.add_row(monitor.row);

        for (let flag of [['follow', 'Перейти на этот workspace'], ['focus', 'Сфокусировать окно']]) {
            let toggle = Ui.switchRow(flag[1], rule[flag[0]] === true, value => {
                Model.setFlag(rule, flag[0], value);
                row.subtitle = Config.describeRule(rule);
                this._store.markDirty(false);
            });
            row.add_row(toggle.row);
        }

        if (!rule.match || typeof rule.match !== 'object')
            rule.match = {};

        for (let key of Object.keys(rule.match))
            row.add_row(this._buildPredicateRow(rule, key, row));

        row.add_row(this._buildAddPredicateRow(rule));

        return row;
    }

    _buildPredicateRow(rule, key, ruleRow) {
        let field = Model.fieldOf(key);
        let type = Matcher.FIELDS[field];
        let value = rule.match[key];

        let update = () => {
            ruleRow.subtitle = Config.describeRule(rule);
            this._store.markDirty(false);
        };

        let remove = Ui.iconButton('user-trash-symbolic', 'Удалить предикат', () => {
            delete rule.match[key];
            this._store.markDirty();
        });

        if (type === 'bool') {
            let toggle = Ui.switchRow(key, value === true, active => {
                rule.match[key] = active;
                update();
            });
            toggle.row.add_suffix(remove);
            return toggle.row;
        }

        if (type === 'range') {
            let entry = Ui.entryRow(key, Model.formatRange(value), text => {
                rule.match[key] = Model.parseRange(text);
                update();
            });
            entry.add_suffix(remove);
            return entry;
        }

        let {pattern, flags} = Model.splitRegexValue(value);

        let flagsEntry = new Gtk.Entry({
            text: flags,
            max_width_chars: 4,
            width_chars: 4,
            placeholder_text: 'flags',
            valign: Gtk.Align.CENTER,
        });

        let entry = Ui.entryRow(key, pattern, text => {
            rule.match[key] = Model.buildRegexValue(text, flagsEntry.get_text());
            update();
        });

        flagsEntry.connect('changed', () => {
            rule.match[key] = Model.buildRegexValue(entry.get_text(), flagsEntry.get_text());
            update();
        });

        entry.add_suffix(flagsEntry);
        entry.add_suffix(remove);

        return entry;
    }

    _buildAddPredicateRow(rule) {
        let keys = Model.availableKeys(rule);
        let row = new Adw.ActionRow({title: 'Добавить предикат'});

        if (keys.length === 0) {
            row.subtitle = 'все предикаты уже заданы';
            return row;
        }

        let dropdown = new Gtk.DropDown({
            model: Gtk.StringList.new(keys),
            valign: Gtk.Align.CENTER,
        });

        row.add_suffix(dropdown);
        row.add_suffix(Ui.iconButton('list-add-symbolic', 'Добавить', () => {
            let key = keys[dropdown.get_selected()];
            Model.addPredicate(rule, key);
            this._store.markDirty();
        }));

        return row;
    }

    _move(index, delta) {
        if (!Model.moveRule(this._store.rules(), index, delta))
            return;

        this._expanded.clear();
        this._store.markDirty();
    }

    _duplicate(index) {
        Model.duplicateRule(this._store.rules(), index);
        this._expanded.clear();
        this._store.markDirty();
    }

    _remove(index) {
        let rules = this._store.rules();
        Ui.confirm(this._store.window, 'Удалить правило?',
            rules[index].name || `правило #${index + 1}`, 'Удалить', () => {
                rules.splice(index, 1);
                this._expanded.clear();
                this._store.markDirty();
            });
    }

    _addRule() {
        let rules = this._store.rules();
        rules.push(Model.newRule(rules));
        this._expanded.clear();
        this._expanded.add(rules.length - 1);
        this._store.markDirty();
    }
};
