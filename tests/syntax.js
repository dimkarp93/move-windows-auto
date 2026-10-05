#!/usr/bin/env -S gjs -m

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

import {check, print, finish} from './harness.js';

const root = GLib.path_get_dirname(GLib.path_get_dirname(
    GLib.filename_from_uri(import.meta.url)[0]));

function read(path) {
    let [ok, bytes] = GLib.file_get_contents(path);
    if (!ok)
        throw new Error(`cannot read ${path}`);
    return new TextDecoder().decode(bytes);
}

function jsFiles(dir) {
    let files = [];
    let enumerator = Gio.File.new_for_path(dir).enumerate_children(
        'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);

    for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null)) {
        let path = GLib.build_filenamev([dir, info.get_name()]);
        if (info.get_file_type() === Gio.FileType.DIRECTORY)
            files.push(...jsFiles(path));
        else if (path.endsWith('.js'))
            files.push(path);
    }

    return files.sort();
}

const relative = path => path.slice(root.length + 1);

for (let flavour of ['legacy43', 'esm48']) {
    let dir = GLib.build_filenamev([root, 'build', flavour]);
    if (!GLib.file_test(dir, GLib.FileTest.IS_DIR)) {
        print(`build/${flavour} is missing, run \`just build\``);
        System.exit(2);
    }
}

print('legacy43 flavour');

for (let path of jsFiles(GLib.build_filenamev([root, 'build', 'legacy43']))) {
    let text = read(path);
    let problem = null;

    try {
        void new Function(text);
    } catch (e) {
        problem = e.message;
    }
    check(`parses as a script: ${relative(path)}`, problem, null);
    check(`has no ES module syntax: ${relative(path)}`, /^(import|export) /m.test(text), false);
}

print('esm48 flavour');

for (let path of jsFiles(GLib.build_filenamev([root, 'build', 'esm48']))) {
    let text = read(path);
    let problem = null;

    try {
        await import(GLib.filename_to_uri(path, null));
    } catch (e) {
        if (e instanceof SyntaxError)
            problem = e.message;
    }
    check(`parses as a module: ${relative(path)}`, problem, null);
    check(`does not use the legacy importer: ${relative(path)}`,
        /\bimports\.(gi|misc|ui|lib)\b/.test(text), false);
}

print('metadata');

let metadata = {};
for (let flavour of ['legacy43', 'esm48'])
    metadata[flavour] = JSON.parse(read(GLib.build_filenamev([root, 'build', flavour, 'metadata.json'])));

const majors = flavour => metadata[flavour]['shell-version'].map(v => parseInt(v, 10));

check('both flavours share one uuid', metadata.legacy43.uuid, metadata.esm48.uuid);
check('the legacy flavour targets only shells that load extensions with imports',
    majors('legacy43').every(v => v >= 43 && v <= 44), true);
check('the esm flavour targets only shells that load extensions as modules',
    majors('esm48').every(v => v >= 45), true);
check('the esm flavour covers the shell shipped in Debian 13', majors('esm48').includes(48), true);
check('the legacy flavour covers the shell shipped in Debian 12', majors('legacy43').includes(43), true);
check('the flavours have the same version', metadata.legacy43.version, metadata.esm48.version);

for (let flavour of ['legacy43', 'esm48']) {
    for (let file of ['extension.js', 'prefs.js', 'metadata.json', 'rules.default.json']) {
        check(`${flavour} ships ${file}`,
            GLib.file_test(GLib.build_filenamev([root, 'build', flavour, file]), GLib.FileTest.EXISTS), true);
    }
}

finish();
