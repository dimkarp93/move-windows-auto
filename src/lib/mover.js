import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Matcher from './matcher.js';
import * as Rules from './rules.js';
import * as Placer from './placer.js';
import * as Dbus from './dbus.js';
import * as Config from './config.js';

const {CONFIG_DIR, CONFIG_PATH} = Config;

const WATCHED_SIGNALS = [
    'notify::title',
    'notify::wm-class',
    'notify::gtk-application-id',
    'notify::maximized-horizontally',
    'notify::maximized-vertically',
    'size-changed',
    'position-changed',
];

let _write = () => {};

function _log(message) {
    _write(`MWA: ${message}`);
}

function _windowTypeName(type) {
    for (let name in Meta.WindowType) {
        if (Meta.WindowType[name] === type)
            return name.toLowerCase();
    }
    return 'unknown';
}

function _readCmdline(pid) {
    if (!pid || pid < 1)
        return null;

    try {
        let [ok, bytes] = GLib.file_get_contents(`/proc/${pid}/cmdline`);
        if (!ok)
            return null;
        return new TextDecoder().decode(bytes).replace(/\0/g, ' ').trim();
    } catch (e) {
        return null;
    }
}

function _describe(window, needsCmdline) {
    let app = Shell.WindowTracker.get_default().get_window_app(window);
    let rect = window.get_frame_rect();

    return {
        appId: app ? app.get_id() : null,
        wmClass: window.get_wm_class(),
        wmClassInstance: window.get_wm_class_instance(),
        role: window.get_role(),
        gtkAppId: window.get_gtk_application_id(),
        windowType: _windowTypeName(window.get_window_type()),
        cmdline: needsCmdline ? _readCmdline(window.get_pid()) : null,
        title: window.get_title(),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        maximized: window.maximized_horizontally && window.maximized_vertically,
        monitor: window.get_monitor(),
    };
}

function _snapshot() {
    let windows = [];

    for (let actor of global.get_window_actors()) {
        let window = actor.meta_window;

        if (!window || window.skip_taskbar || window.is_on_all_workspaces())
            continue;

        let workspace = window.get_workspace();
        if (!workspace)
            continue;

        windows.push(Object.assign(_describe(window, true), {
            id: window.get_id(),
            workspace: workspace.index() + 1,
            focused: window.has_focus(),
        }));
    }

    windows.sort((a, b) => a.workspace - b.workspace);

    return windows;
}

class DBusService {
    constructor(onReload) {
        this._onReload = onReload;
        this._exported = Gio.DBusExportedObject.wrapJSObject(Dbus.INTERFACE, this);
        this._exported.export(Gio.DBus.session, Dbus.PATH);
        this._nameId = Gio.bus_own_name(Gio.BusType.SESSION, Dbus.NAME,
            Gio.BusNameOwnerFlags.REPLACE, null, null, null);
    }

    ListWindows() {
        return JSON.stringify(_snapshot());
    }

    Reload() {
        return this._onReload();
    }

    destroy() {
        if (this._nameId) {
            Gio.bus_unown_name(this._nameId);
            this._nameId = 0;
        }

        if (this._exported) {
            this._exported.unexport();
            this._exported = null;
        }
    }
}

class PendingWindow {
    constructor(window, config, onFinished) {
        this._window = window;
        this._config = config;
        this._onFinished = onFinished;
        this._signalIds = [];
        this._timeoutId = 0;
        this._finished = false;
        this._appliedIndex = -1;
    }

    start() {
        if (this._evaluate('created'))
            return;

        for (let signal of WATCHED_SIGNALS) {
            this._signalIds.push(this._window.connect(signal,
                () => void this._evaluate(signal)));
        }
        this._signalIds.push(this._window.connect('unmanaged',
            () => this._finish()));

        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            this._config.settleMs, () => {
                this._timeoutId = 0;
                this._onDeadline();
                return GLib.SOURCE_REMOVE;
            });
    }

    reevaluate(reason) {
        this._evaluate(reason);
    }

    _evaluate(reason) {
        if (this._finished)
            return true;

        let descriptor = _describe(this._window, this._config.needsCmdline);
        let {action, index, waitingFor} = Matcher.evaluate(descriptor, this._config.rules);

        if (this._config.debug && reason === 'created')
            _log(`window created ${JSON.stringify(descriptor)}`);

        if (action === 'apply') {
            this._finalize(index, reason);
            return true;
        }

        if (action === 'none') {
            if (this._config.debug)
                _log(`no rule can match, leaving in place (${reason})`);
            this._finish();
            return true;
        }

        if (index >= 0)
            this._applyProvisional(index, reason);

        if (this._config.debug && reason === 'created') {
            let rule = this._config.rules[waitingFor];
            let pending = Matcher.describeUnmatched(descriptor, rule).join(', ');
            _log(`waiting up to ${this._config.settleMs}ms for [${rule.name}] on: ${pending}`);
        }

        return false;
    }

    _applyProvisional(index, reason) {
        if (index === this._appliedIndex)
            return;

        let rule = this._config.rules[index];
        let error = Placer.place(this._window, rule, false);

        if (error) {
            _log(`[${rule.name}] not applied: ${error}`);
            return;
        }

        this._appliedIndex = index;

        if (this._config.debug)
            _log(`[${rule.name}] -> workspace ${rule.workspace} (${reason}, provisional)`);
    }

    _finalize(index, reason) {
        let rule = this._config.rules[index];

        if (index === this._appliedIndex) {
            Placer.activate(this._window, rule);
            if (this._config.debug)
                _log(`[${rule.name}] confirmed on workspace ${rule.workspace} (${reason})`);
        } else {
            let error = Placer.place(this._window, rule, true);
            if (error)
                _log(`[${rule.name}] not applied: ${error}`);
            else if (this._config.debug)
                _log(`[${rule.name}] -> workspace ${rule.workspace} (${reason})`);
        }

        this._finish();
    }

    _onDeadline() {
        if (this._finished)
            return;

        let descriptor = _describe(this._window, this._config.needsCmdline);
        let index = Matcher.resolve(descriptor, this._config.rules);

        if (index >= 0) {
            this._finalize(index, 'deadline');
            return;
        }

        if (this._config.debug)
            _log(`no rule matched by deadline, leaving in place: ${JSON.stringify(descriptor)}`);

        this._finish();
    }

    _finish() {
        if (this._finished)
            return;
        this._finished = true;

        for (let id of this._signalIds)
            this._window.disconnect(id);
        this._signalIds = [];

        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }

        this._onFinished(this);
    }

    destroy() {
        this._onFinished = () => {};
        this._finish();
    }
}

class WindowMover {
    constructor(extensionPath) {
        this._extensionPath = extensionPath;
        this._config = null;
        this._pending = new Set();
        this._trackerId = 0;

        this._seedConfig();
        this._loadConfig();

        this._windowCreatedId = global.display.connect('window-created',
            (display, window) => this._onWindowCreated(window));
    }

    _seedConfig() {
        if (GLib.file_test(CONFIG_PATH, GLib.FileTest.EXISTS))
            return;

        try {
            GLib.mkdir_with_parents(CONFIG_DIR, 0o755);
            let source = Gio.File.new_for_path(GLib.build_filenamev([this._extensionPath, 'rules.default.json']));
            source.copy(Gio.File.new_for_path(CONFIG_PATH), Gio.FileCopyFlags.NONE, null, null);
            _log(`created default config at ${CONFIG_PATH}`);
        } catch (e) {
            _log(`could not create default config: ${e.message}`);
        }
    }

    _loadConfig() {
        let text;
        try {
            let [ok, bytes] = GLib.file_get_contents(CONFIG_PATH);
            if (!ok)
                throw new Error('could not read file');
            text = new TextDecoder().decode(bytes);
        } catch (e) {
            let message = `config ${CONFIG_PATH} unreadable: ${e.message}`;
            _log(message);
            if (!this._config)
                this._config = Rules.compile({rules: []});
            return [false, message];
        }

        try {
            this._config = Rules.parse(text);
            let message = `loaded ${this._config.rules.length} rules from ${CONFIG_PATH}`;
            _log(message);
            return [true, message];
        } catch (e) {
            _log(`config rejected, keeping previous rules: ${e.message}`);
            if (!this._config)
                this._config = Rules.compile({rules: []});
            return [false, e.message];
        }
    }

    reload() {
        return this._loadConfig();
    }

    _onWindowCreated(window) {
        if (!this._config || this._config.rules.length === 0)
            return;
        if (window.skip_taskbar || window.is_on_all_workspaces())
            return;
        if (window.get_window_type() !== Meta.WindowType.NORMAL && !this._config.anyWindowType)
            return;

        let pending = new PendingWindow(window, this._config,
            p => this._onPendingFinished(p));

        this._pending.add(pending);
        this._updateTrackerConnection();
        pending.start();
    }

    _onPendingFinished(pending) {
        this._pending.delete(pending);
        this._updateTrackerConnection();
    }

    _updateTrackerConnection() {
        let tracker = Shell.WindowTracker.get_default();

        if (this._pending.size > 0 && !this._trackerId) {
            this._trackerId = tracker.connect('tracked-windows-changed', () => {
                for (let pending of [...this._pending])
                    pending.reevaluate('app-resolved');
            });
        } else if (this._pending.size === 0 && this._trackerId) {
            tracker.disconnect(this._trackerId);
            this._trackerId = 0;
        }
    }

    destroy() {
        if (this._windowCreatedId) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = 0;
        }

        if (this._trackerId) {
            Shell.WindowTracker.get_default().disconnect(this._trackerId);
            this._trackerId = 0;
        }

        for (let pending of [...this._pending])
            pending.destroy();
        this._pending.clear();

        this._config = null;
    }
}

export class Controller {
    constructor(host) {
        this._host = host;
        this._windowMover = null;
        this._dbusService = null;
    }

    enable() {
        _write = this._host.log;

        this._windowMover = new WindowMover(this._host.path);

        try {
            this._dbusService = new DBusService(() => this._windowMover.reload());
        } catch (e) {
            _log(`D-Bus interface unavailable: ${e.message}`);
        }
    }

    disable() {
        if (this._dbusService) {
            this._dbusService.destroy();
            this._dbusService = null;
        }

        if (this._windowMover) {
            this._windowMover.destroy();
            this._windowMover = null;
        }
    }
}
