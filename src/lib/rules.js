import * as Matcher from './matcher.js';

export const MIN_SETTLE_MS = 2000;
export const DEFAULT_SETTLE_MS = 2500;

function _fail(where, message) {
    throw new Error(`${where}: ${message}`);
}

function _compileRegex(where, key, value) {
    let pattern = value;
    let flags = '';

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        if (typeof value.pattern !== 'string')
            _fail(where, `"${key}" object form requires a string "pattern"`);
        pattern = value.pattern;
        if (value.flags !== undefined) {
            if (typeof value.flags !== 'string')
                _fail(where, `"${key}.flags" must be a string`);
            flags = value.flags;
        }
    } else if (typeof value !== 'string') {
        _fail(where, `"${key}" must be a regex string or {pattern, flags}`);
    }

    try {
        return new RegExp(pattern, flags);
    } catch (e) {
        _fail(where, `"${key}" is not a valid regex: ${e.message}`);
    }
    return null;
}

function _compileRange(where, key, value) {
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            _fail(where, `"${key}" must be a finite number`);
        return {min: value, max: value};
    }

    if (value === null || typeof value !== 'object' || Array.isArray(value))
        _fail(where, `"${key}" must be a number or {min, max}`);

    let range = {};
    for (let bound of ['min', 'max']) {
        if (value[bound] === undefined)
            continue;
        if (typeof value[bound] !== 'number' || !Number.isFinite(value[bound]))
            _fail(where, `"${key}.${bound}" must be a finite number`);
        range[bound] = value[bound];
    }

    if (range.min === undefined && range.max === undefined)
        _fail(where, `"${key}" needs at least one of "min" or "max"`);
    if (range.min !== undefined && range.max !== undefined && range.min > range.max)
        _fail(where, `"${key}" has min greater than max`);

    return range;
}

function _compilePredicate(where, key, value) {
    let negated = key.endsWith('Not');
    let field = negated ? key.slice(0, -3) : key;

    if (!(field in Matcher.FIELDS))
        _fail(where, `unknown match key "${key}", expected one of: ${Matcher.PREDICATE_KEYS.join(', ')}`);
    if (negated && !Matcher.isStringField(field))
        _fail(where, `"${key}" is not supported, negation only applies to regex fields`);

    let spec;
    switch (Matcher.FIELDS[field]) {
    case 'string':
        spec = _compileRegex(where, key, value);
        break;
    case 'range':
        spec = _compileRange(where, key, value);
        break;
    case 'bool':
        if (typeof value !== 'boolean')
            _fail(where, `"${key}" must be true or false`);
        spec = value;
        break;
    }

    return {key, field, negated, spec};
}

function _compileRule(raw, position) {
    let where = `rule #${position + 1}`;

    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        _fail(where, 'must be an object');

    if (raw.name !== undefined) {
        if (typeof raw.name !== 'string' || raw.name === '')
            _fail(where, '"name" must be a non-empty string');
        where = `rule "${raw.name}"`;
    }

    if (!Number.isInteger(raw.workspace) || raw.workspace < 1)
        _fail(where, '"workspace" must be an integer >= 1');

    if (raw.match === null || typeof raw.match !== 'object' || Array.isArray(raw.match))
        _fail(where, '"match" must be an object');

    let keys = Object.keys(raw.match);
    if (keys.length === 0)
        _fail(where, '"match" must contain at least one predicate');

    let predicates = keys.map(key => _compilePredicate(where, key, raw.match[key]));

    for (let flag of ['follow', 'focus']) {
        if (raw[flag] !== undefined && typeof raw[flag] !== 'boolean')
            _fail(where, `"${flag}" must be true or false`);
    }

    if (raw.monitor !== undefined && (!Number.isInteger(raw.monitor) || raw.monitor < 0))
        _fail(where, '"monitor" must be an integer >= 0');

    return {
        name: raw.name || `rule #${position + 1}`,
        workspace: raw.workspace,
        follow: raw.follow === true,
        focus: raw.focus === true,
        monitor: raw.monitor === undefined ? null : raw.monitor,
        predicates,
    };
}

export function compile(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        _fail('config', 'must be a JSON object');

    if (!Array.isArray(raw.rules))
        _fail('config', '"rules" must be an array');

    if (raw.settleMs !== undefined &&
        (!Number.isInteger(raw.settleMs) || raw.settleMs < MIN_SETTLE_MS))
        _fail('config', `"settleMs" must be an integer >= ${MIN_SETTLE_MS}`);

    if (raw.debug !== undefined && typeof raw.debug !== 'boolean')
        _fail('config', '"debug" must be true or false');

    let rules = raw.rules.map(_compileRule);

    let fields = new Set();
    for (let rule of rules) {
        for (let predicate of rule.predicates)
            fields.add(predicate.field);
    }

    return {
        settleMs: raw.settleMs === undefined ? DEFAULT_SETTLE_MS : raw.settleMs,
        debug: raw.debug === true,
        rules,
        needsCmdline: fields.has('cmdline'),
        anyWindowType: fields.has('windowType'),
    };
}

export function parse(text) {
    let raw;
    try {
        raw = JSON.parse(text);
    } catch (e) {
        _fail('config', `invalid JSON: ${e.message}`);
    }
    return compile(raw);
}
