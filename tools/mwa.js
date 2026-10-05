import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

import * as Config from '../src/lib/config.js';
import * as Dbus from '../src/lib/dbus.js';
import * as Cli from './cli.js';

const USAGE = `usage: gjs -m tools/mwa.js COMMAND [ARGS]

  windows                          open windows as the extension sees them
  focused [-j]                     focused window and a rule skeleton
  skeleton [-j] WMCLASS TITLE      rule skeleton for an X11 window
  add-rule FILE NAME WORKSPACE SKELETON [-t]
                                   add a rule built from SKELETON to FILE
  validate FILE                    check FILE the way the extension does
  config-info FILE                 number of rules and the debug flag
  debug on|off                     switch the debug log in the live config
  enable UUID                      add UUID to org.gnome.shell enabled-extensions`;

function fail(message, code = 1) {
    printerr(`mwa: ${message}`);
    System.exit(code);
}

function callExtension(method) {
    try {
        let reply = Gio.DBus.session.call_sync(Dbus.NAME, Dbus.PATH, Dbus.NAME, method,
            null, null, Gio.DBusCallFlags.NONE, -1, null);
        return reply.deepUnpack();
    } catch (e) {
        return fail(`the extension does not answer on D-Bus, is it enabled?\n${e.message}`);
    }
}

function listWindows() {
    return JSON.parse(callExtension('ListWindows')[0]);
}

function flag(args, name) {
    let index = args.indexOf(name);
    if (index < 0)
        return false;
    args.splice(index, 1);
    return true;
}

function sameFile(a, b) {
    try {
        let query = path => Gio.File.new_for_path(path).query_info('unix::device,unix::inode',
            Gio.FileQueryInfoFlags.NONE, null);
        let x = query(a);
        let y = query(b);
        return x.get_attribute_uint32('unix::device') === y.get_attribute_uint32('unix::device') &&
            x.get_attribute_uint64('unix::inode') === y.get_attribute_uint64('unix::inode');
    } catch (e) {
        return false;
    }
}

function readConfig(path) {
    let {raw, error} = Config.readPath(path);
    if (error)
        fail(error);
    return raw;
}

function writeConfig(path, raw) {
    let error = Config.writePath(path, raw);
    if (error)
        fail(error);
}

function printSkeleton(rule, json) {
    print(json ? JSON.stringify(rule, null, 2) : `\n${Cli.skeletonText(rule)}`);
}

const commands = {
    windows() {
        print(Cli.windowsTable(listWindows()));
    },

    focused(args) {
        let json = flag(args, '-j');
        let window = listWindows().find(w => w.focused);
        if (!window)
            fail('no focused window; use -d to leave time to focus one');

        if (!json)
            print(Cli.describeWindow(window));
        printSkeleton(Cli.skeleton(window), json);

        if (!json && !window.title)
            printerr('\nnote: this window has no title, match it by class or role instead');
    },

    skeleton(args) {
        let json = flag(args, '-j');
        if (args.length !== 2)
            fail(USAGE, 2);
        printSkeleton(Cli.skeleton({wmClass: args[0], title: args[1]}), json);
    },

    'add-rule'(args) {
        let keepTitle = flag(args, '-t');
        if (args.length !== 4)
            fail(USAGE, 2);

        let [path, name, workspaceText, skeletonText] = args;
        let workspace = Number(workspaceText);
        if (!Number.isInteger(workspace) || workspace < 1)
            fail('WORKSPACE must be an integer >= 1', 2);

        let raw = GLib.file_test(path, GLib.FileTest.EXISTS) ? readConfig(path) : Config.defaultConfig();

        let result;
        try {
            result = Cli.addRule(raw, JSON.parse(skeletonText), {name, workspace, keepTitle});
        } catch (e) {
            fail(`${e.message}; ${path} is untouched`);
        }

        writeConfig(path, result.raw);
        print(JSON.stringify(result.rule));
        print(result.where);
        print(`written to ${path}`);

        if (sameFile(path, Config.CONFIG_PATH)) {
            try {
                let reply = Gio.DBus.session.call_sync(Dbus.NAME, Dbus.PATH, Dbus.NAME, 'Reload',
                    null, null, Gio.DBusCallFlags.NONE, -1, null);
                let [ok, message] = reply.deepUnpack();
                print(`extension: ${ok ? 'reloaded' : 'kept previous rules'}, ${message}`);
            } catch (e) {
                print('extension does not answer, the rule applies after it is enabled');
            }
        }
    },

    validate(args) {
        if (args.length !== 1)
            fail(USAGE, 2);
        readConfig(args[0]);
    },

    'config-info'(args) {
        if (args.length !== 1)
            fail(USAGE, 2);
        let {raw, error} = Config.readPath(args[0]);
        if (!raw)
            fail(error);

        let info = Cli.configInfo(raw);
        print(`rules     ${info.rules}`);
        print(`debug     ${info.debug}`);
        if (error)
            print(`invalid   ${error}`);
    },

    debug(args) {
        let value = {on: true, off: false}[args[0]];
        if (args.length !== 1 || value === undefined)
            fail('usage: just debug [on|off]', 2);

        let {raw, error} = Config.readPath(Config.CONFIG_PATH);
        if (!raw)
            fail(error);
        raw.debug = value;
        writeConfig(Config.CONFIG_PATH, raw);
        print(`debug=${value} in ${Config.CONFIG_PATH}`);
    },

    enable(args) {
        if (args.length !== 1)
            fail(USAGE, 2);

        let settings = new Gio.Settings({schema_id: 'org.gnome.shell'});
        let next = Cli.enabledWith(settings.get_strv('enabled-extensions'), args[0]);
        if (!next) {
            print(`${args[0]} already listed`);
            return;
        }

        settings.set_strv('enabled-extensions', next);
        Gio.Settings.sync();
        print(`added ${args[0]} to enabled-extensions, it loads on the next shell restart`);
    },
};

let [command, ...args] = ARGV;

if (command === '-h' || command === '--help') {
    print(USAGE);
} else if (commands[command]) {
    commands[command](args);
} else {
    fail(USAGE, 2);
}
