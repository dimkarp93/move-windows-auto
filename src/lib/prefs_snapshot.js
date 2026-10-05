import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import * as Dbus from './dbus.js';
import * as Model from './prefs_model.js';
import * as Suggest from './suggest.js';
import * as Ui from './ui.js';

const {MAX_WORKSPACE} = Model;
const CALL_TIMEOUT_MS = 3000;

const UNAVAILABLE = 'Расширение не отвечает по D-Bus. Убедитесь, что оно включено ' +
    '(just status), и перезапустите GNOME Shell: Alt+F2, r, Enter.';

function _listWindows() {
    let reply = Gio.DBus.session.call_sync(Dbus.NAME, Dbus.PATH, Dbus.NAME,
        'ListWindows', null, new GLib.VariantType('(s)'),
        Gio.DBusCallFlags.NONE, CALL_TIMEOUT_MS, null);

    let [json] = reply.deep_unpack();
    return JSON.parse(json);
}

export class SnapshotPage {
    constructor(store) {
        this._store = store;
        this._drafts = [];

        this.page = new Adw.PreferencesPage({
            title: 'Снимок',
            icon_name: 'view-grid-symbolic',
        });

        let intro = new Adw.PreferencesGroup({
            title: 'Текущее состояние сессии',
            description: 'Снимок берёт открытые окна и их workspace у запущенного расширения ' +
                'и предлагает фильтры: заголовок добавляется только там, где окна одного ' +
                'приложения разложены по разным workspace.',
        });

        let capture = new Gtk.Button({
            label: 'Зафиксировать',
            css_classes: ['suggested-action'],
            valign: Gtk.Align.CENTER,
        });
        capture.connect('clicked', () => this._capture());
        intro.set_header_suffix(capture);
        this.page.add(intro);

        this._group = new Adw.PreferencesGroup({title: 'Окна'});
        this._applyButton = new Gtk.Button({
            label: 'Добавить правила',
            sensitive: false,
            valign: Gtk.Align.CENTER,
        });
        this._applyButton.connect('clicked', () => this._apply());
        this._group.set_header_suffix(this._applyButton);
        this.page.add(this._group);

        this._rows = [];
        this._showPlaceholder('Нажмите «Зафиксировать», чтобы увидеть открытые окна');
    }

    _clear() {
        for (let row of this._rows)
            this._group.remove(row);
        this._rows = [];
    }

    _showPlaceholder(text) {
        this._clear();
        let row = new Adw.ActionRow({title: text});
        this._group.add(row);
        this._rows.push(row);
    }

    _capture() {
        let descriptors;

        try {
            descriptors = _listWindows();
        } catch (e) {
            Ui.alert(this._store.window, 'Снимок недоступен', `${UNAVAILABLE}\n\n${e.message}`);
            return;
        }

        this._drafts = Suggest.suggest(descriptors);

        for (let draft of this._drafts)
            draft.include = true;

        this._render();
    }

    _render() {
        this._clear();

        if (this._drafts.length === 0) {
            this._applyButton.sensitive = false;
            this._showPlaceholder('Подходящих окон не найдено');
            return;
        }

        for (let draft of this._drafts) {
            let row = this._buildDraftRow(draft);
            this._group.add(row);
            this._rows.push(row);
        }

        this._updateApplyButton();
    }

    _updateApplyButton() {
        let count = Model.includedCount(this._drafts);
        this._applyButton.sensitive = count > 0;
        this._applyButton.label = count > 0
            ? `Добавить правила (${count})`
            : 'Добавить правила';
    }

    _buildDraftRow(draft) {
        let descriptor = draft.descriptor;
        let identity = descriptor.appId || descriptor.wmClass || descriptor.role || '—';

        let row = new Adw.ExpanderRow({
            title: GLib.markup_escape_text(descriptor.title || '(без заголовка)', -1),
            subtitle: `${GLib.markup_escape_text(identity, -1)} · workspace ${draft.workspace}`,
        });

        let include = new Gtk.CheckButton({active: true, valign: Gtk.Align.CENTER});
        include.set_tooltip_text('Двигать это окно по правилу');
        include.connect('toggled', () => {
            draft.include = include.active;
            this._updateApplyButton();
        });
        row.add_prefix(include);

        row.add_row(Ui.entryRow('Название правила', draft.name, text => {
            draft.name = text;
        }));

        let workspace = Ui.spinRow('Workspace', {
            min: 1,
            max: MAX_WORKSPACE,
            value: draft.workspace,
            onChange: value => {
                draft.workspace = value;
                row.subtitle = `${GLib.markup_escape_text(identity, -1)} · workspace ${value}`;
            },
        });
        row.add_row(workspace.row);

        for (let field of Suggest.CANDIDATE_FIELDS) {
            if (!draft.candidates[field])
                continue;

            let entry = Ui.entryRow(field, draft.candidates[field], text => {
                draft.candidates[field] = text;
            });

            let use = new Gtk.CheckButton({
                active: draft.selected.includes(field),
                valign: Gtk.Align.CENTER,
            });
            use.set_tooltip_text('Использовать этот предикат');
            use.connect('toggled', () => {
                Model.toggleSelected(draft, field, use.active);
            });

            entry.add_prefix(use);
            row.add_row(entry);
        }

        return row;
    }

    _apply() {
        let additions = Model.additionsFromDrafts(this._drafts);

        if (additions.length === 0) {
            Ui.alert(this._store.window, 'Нечего добавлять',
                'Ни у одного выбранного окна не отмечен ни один предикат.');
            return;
        }

        let {rules, error} = Model.mergeAdditions(this._store.raw, additions);

        if (error) {
            Ui.alert(this._store.window, 'Правила отклонены', error);
            return;
        }

        this._store.setRules(rules);
        this._store.save();
        this._store.showRules();
    }
};
