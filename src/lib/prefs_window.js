import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import * as Config from './config.js';
import * as Dbus from './dbus.js';
import * as PrefsRules from './prefs_rules.js';
import * as PrefsSnapshot from './prefs_snapshot.js';
import * as Ui from './ui.js';

const SELF_WRITE_GRACE_MS = 800;
const RELOAD_TIMEOUT_MS = 3000;

function _reloadExtension() {
    try {
        let reply = Gio.DBus.session.call_sync(Dbus.NAME, Dbus.PATH, Dbus.NAME,
            'Reload', null, new GLib.VariantType('(bs)'),
            Gio.DBusCallFlags.NONE, RELOAD_TIMEOUT_MS, null);
        let [ok, message] = reply.deep_unpack();
        return {ok, message, reachable: true};
    } catch (e) {
        return {ok: false, message: e.message, reachable: false};
    }
}

class Store {
    constructor(window) {
        this.window = window;
        this.dirty = false;
        this.raw = Config.defaultConfig();

        this._changedCbs = [];
        this._dirtyCbs = [];
        this._selfWrite = false;
        this._selfWriteId = 0;
        this._closing = false;

        this._load();
        this._installActions();
        this._watch();

        window.connect('close-request', () => this._onCloseRequest());
        window.connect('destroy', () => this._teardown());
    }

    onChanged(callback) {
        this._changedCbs.push(callback);
    }

    onDirty(callback) {
        this._dirtyCbs.push(callback);
    }

    setPages(rulesPage) {
        this._rulesPage = rulesPage;
    }

    showRules() {
        if (this._rulesPage)
            this.window.set_visible_page(this._rulesPage);
    }

    rules() {
        if (!Array.isArray(this.raw.rules))
            this.raw.rules = [];
        return this.raw.rules;
    }

    setRules(rules) {
        this.raw.rules = rules;
        this.markDirty();
    }

    markDirty(refresh = true) {
        this.dirty = true;

        for (let callback of this._dirtyCbs)
            callback();

        if (refresh)
            this._emitChanged();
    }

    toast(text) {
        this.window.add_toast(new Adw.Toast({title: text}));
    }

    save() {
        let error = Config.validate(this.raw);

        if (error) {
            Ui.alert(this.window, 'Конфигурация отклонена', error);
            return false;
        }

        this._selfWrite = true;
        if (this._selfWriteId)
            GLib.source_remove(this._selfWriteId);
        this._selfWriteId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SELF_WRITE_GRACE_MS, () => {
            this._selfWrite = false;
            this._selfWriteId = 0;
            return GLib.SOURCE_REMOVE;
        });

        let failure = Config.write(this.raw);

        if (failure) {
            Ui.alert(this.window, 'Не удалось сохранить', failure);
            return false;
        }

        this.dirty = false;

        for (let callback of this._dirtyCbs)
            callback();

        let reload = _reloadExtension();

        if (!reload.reachable)
            this.toast('Сохранено, но расширение не отвечает: правила применятся после его включения');
        else if (!reload.ok)
            Ui.alert(this.window, 'Расширение отклонило конфигурацию', reload.message);
        else
            this.toast('Сохранено и применено');

        return true;
    }

    revert() {
        this._load();
        this.dirty = false;

        for (let callback of this._dirtyCbs)
            callback();

        this._emitChanged();
        this.toast('Изменения сброшены к сохранённым в файле');
    }

    _emitChanged() {
        for (let callback of this._changedCbs)
            callback();
    }

    _load() {
        let {raw, error} = Config.read();

        if (raw)
            this.raw = raw;

        if (error)
            Ui.alert(this.window, 'Проблема в rules.json', error);
    }

    _installActions() {
        let group = new Gio.SimpleActionGroup();

        let add = (name, handler) => {
            let action = new Gio.SimpleAction({name});
            action.connect('activate', handler);
            group.add_action(action);
        };

        add('import', () => this._import());
        add('export', () => this._export());

        this.window.insert_action_group('prefs', group);
    }

    _chooser(title, action, acceptLabel, onPath) {
        let chooser = new Gtk.FileChooserNative({
            title,
            action,
            accept_label: acceptLabel,
            transient_for: this.window,
            modal: true,
        });

        let filter = new Gtk.FileFilter({name: 'JSON'});
        filter.add_pattern('*.json');
        chooser.add_filter(filter);

        if (action === Gtk.FileChooserAction.SAVE)
            chooser.set_current_name('rules.json');

        chooser.connect('response', (_chooser, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                let file = chooser.get_file();
                if (file)
                    onPath(file.get_path());
            }
            chooser.destroy();
        });

        this._chooserRef = chooser;
        chooser.show();
    }

    _import() {
        this._chooser('Импорт правил', Gtk.FileChooserAction.OPEN, 'Импортировать', path => {
            let {raw, error} = Config.readPath(path);

            if (error) {
                Ui.alert(this.window, 'Импорт отклонён', error);
                return;
            }

            this.raw = raw;
            this.markDirty();
            this.toast(`Импортировано из ${path}, нажмите «Сохранить»`);
        });
    }

    _export() {
        this._chooser('Экспорт правил', Gtk.FileChooserAction.SAVE, 'Экспортировать', path => {
            let failure = Config.writePath(path, this.raw);

            if (failure)
                Ui.alert(this.window, 'Не удалось экспортировать', failure);
            else
                this.toast(`Экспортировано в ${path}`);
        });
    }

    _watch() {
        try {
            let file = Gio.File.new_for_path(Config.CONFIG_DIR);
            this._monitor = file.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitorId = this._monitor.connect('changed', (monitor, changed) => {
                if (changed.get_basename() !== 'rules.json' || this._selfWrite)
                    return;

                if (this.dirty) {
                    this.toast('Файл изменён снаружи, но есть несохранённые правки');
                    return;
                }

                this._load();
                this._emitChanged();
                this.toast('Файл изменён снаружи, правила перечитаны');
            });
        } catch (e) {
            logError(e, 'move-windows-auto: config monitor unavailable');
        }
    }

    _onCloseRequest() {
        if (!this.dirty || this._closing)
            return false;

        let dialog = new Adw.MessageDialog({
            transient_for: this.window,
            modal: true,
            heading: 'Есть несохранённые изменения',
            body: 'Сохранить их в rules.json перед закрытием?',
        });

        dialog.add_response('cancel', 'Отмена');
        dialog.add_response('discard', 'Не сохранять');
        dialog.add_response('save', 'Сохранить');
        dialog.set_response_appearance('discard', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);

        dialog.connect('response', (_dialog, response) => {
            if (response === 'cancel')
                return;
            if (response === 'save' && !this.save())
                return;

            this._closing = true;
            this.window.close();
        });

        dialog.present();
        return true;
    }

    _teardown() {
        if (this._selfWriteId) {
            GLib.source_remove(this._selfWriteId);
            this._selfWriteId = 0;
        }

        if (this._monitor) {
            this._monitor.disconnect(this._monitorId);
            this._monitor.cancel();
            this._monitor = null;
        }
    }
}

export function fillWindow(window) {
    window.set_default_size(760, 860);
    window.set_search_enabled(true);

    let store = new Store(window);
    let rules = new PrefsRules.RulesPage(store);
    let snapshot = new PrefsSnapshot.SnapshotPage(store);

    window.add(rules.page);
    window.add(snapshot.page);

    store.setPages(rules.page);
}
