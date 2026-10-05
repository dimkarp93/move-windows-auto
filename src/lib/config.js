import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Rules from './rules.js';

export const CONFIG_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'move-windows-auto']);
export const CONFIG_PATH = GLib.build_filenamev([CONFIG_DIR, 'rules.json']);

export function defaultConfig() {
    return {settleMs: Rules.DEFAULT_SETTLE_MS, debug: false, rules: []};
}

export function serialize(raw) {
    return `${JSON.stringify(raw, null, 2)}\n`;
}

export function parse(text) {
    let raw = JSON.parse(text);

    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error('config: must be a JSON object');

    return raw;
}

export function validate(raw) {
    try {
        Rules.compile(raw);
        return null;
    } catch (e) {
        return e.message;
    }
}

export function readPath(path) {
    let text;

    try {
        let [ok, bytes] = GLib.file_get_contents(path);
        if (!ok)
            throw new Error('could not read file');
        text = new TextDecoder().decode(bytes);
    } catch (e) {
        return {raw: null, error: `${path}: ${e.message}`};
    }

    let raw;
    try {
        raw = parse(text);
    } catch (e) {
        return {raw: null, error: `${path}: ${e.message}`};
    }

    let invalid = validate(raw);
    if (invalid)
        return {raw, error: invalid};

    return {raw, error: null};
}

export function read() {
    if (!GLib.file_test(CONFIG_PATH, GLib.FileTest.EXISTS))
        return {raw: defaultConfig(), error: null};

    return readPath(CONFIG_PATH);
}

export function writePath(path, raw) {
    try {
        let file = Gio.File.new_for_path(path);
        let parent = file.get_parent();
        if (parent && !parent.query_exists(null))
            parent.make_directory_with_parents(null);

        file.replace_contents(new TextEncoder().encode(serialize(raw)), null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        return null;
    } catch (e) {
        return `${path}: ${e.message}`;
    }
}

export function write(raw) {
    return writePath(CONFIG_PATH, raw);
}

export function matchKey(rule) {
    let match = rule && rule.match ? rule.match : {};
    let keys = Object.keys(match).sort();
    return JSON.stringify(keys.map(key => [key, match[key]]));
}

function _isSubsetOf(rule, candidate) {
    let outer = candidate.match || {};
    let inner = rule.match || {};
    let keys = Object.keys(inner);

    if (keys.length === 0 || keys.length >= Object.keys(outer).length)
        return false;

    return keys.every(key =>
        JSON.stringify(outer[key]) === JSON.stringify(inner[key]));
}

export function mergeRules(existing, additions) {
    let rules = existing.slice();

    for (let addition of additions) {
        let index = rules.findIndex(rule => matchKey(rule) === matchKey(addition));

        if (index >= 0) {
            rules[index] = Object.assign({}, addition, {name: rules[index].name || addition.name});
            continue;
        }

        let general = rules.findIndex(rule => _isSubsetOf(rule, addition));
        if (general >= 0)
            rules.splice(general, 0, addition);
        else
            rules.push(addition);
    }

    return rules;
}

export function describeRule(rule) {
    let match = rule.match || {};
    let parts = Object.keys(match).map(key => {
        let value = match[key];
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            if (typeof value.pattern === 'string')
                return `${key} ~ ${value.pattern}`;
            return `${key} ${JSON.stringify(value)}`;
        }
        return typeof value === 'string' ? `${key} ~ ${value}` : `${key} = ${value}`;
    });

    let target = `workspace ${rule.workspace}`;
    if (rule.monitor !== undefined && rule.monitor !== null)
        target += `, monitor ${rule.monitor}`;
    if (rule.follow)
        target += ', follow';
    if (rule.focus)
        target += ', focus';

    return `${parts.join('; ') || 'нет предикатов'} → ${target}`;
}
