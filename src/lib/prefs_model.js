import * as Config from './config.js';
import * as Matcher from './matcher.js';
import * as Suggest from './suggest.js';

export const MAX_WORKSPACE = 36;

export function fieldOf(key) {
    return key.endsWith('Not') ? key.slice(0, -3) : key;
}

export function formatRange(value) {
    if (typeof value === 'number')
        return String(value);

    if (value !== null && typeof value === 'object') {
        let min = value.min === undefined ? '' : String(value.min);
        let max = value.max === undefined ? '' : String(value.max);
        return `${min}..${max}`;
    }

    return String(value);
}

export function parseRange(text) {
    let raw = text.trim();

    if (raw.includes('..')) {
        let [min, max] = raw.split('..');
        let range = {};
        if (min.trim() !== '')
            range.min = Number(min);
        if (max.trim() !== '')
            range.max = Number(max);
        return Object.keys(range).length > 0 ? range : raw;
    }

    let number = Number(raw);
    return raw !== '' && Number.isFinite(number) ? number : raw;
}

export function defaultValue(key) {
    switch (Matcher.FIELDS[fieldOf(key)]) {
    case 'string':
        return '';
    case 'range':
        return 0;
    case 'bool':
        return true;
    default:
        return '';
    }
}

export function splitRegexValue(value) {
    if (value !== null && typeof value === 'object') {
        return {
            pattern: value.pattern === undefined ? '' : String(value.pattern),
            flags: value.flags || '',
        };
    }

    return {pattern: value === undefined || value === null ? '' : String(value), flags: ''};
}

export function buildRegexValue(pattern, flags) {
    return flags ? {pattern, flags} : pattern;
}

export function ruleTitle(rule, index) {
    return rule.name || `правило #${index + 1}`;
}

export function newRule(rules) {
    return {name: `rule-${rules.length + 1}`, match: {wmClass: ''}, workspace: 1};
}

export function moveRule(rules, index, delta) {
    let target = index + delta;

    if (index < 0 || index >= rules.length || target < 0 || target >= rules.length)
        return false;

    let [rule] = rules.splice(index, 1);
    rules.splice(target, 0, rule);
    return true;
}

export function duplicateRule(rules, index) {
    let copy = JSON.parse(JSON.stringify(rules[index]));
    copy.name = `${copy.name || 'rule'}-copy`;
    rules.splice(index + 1, 0, copy);
    return copy;
}

export function availableKeys(rule) {
    let match = rule.match || {};
    return Matcher.PREDICATE_KEYS.filter(key => !(key in match));
}

export function addPredicate(rule, key) {
    if (!rule.match || typeof rule.match !== 'object')
        rule.match = {};
    rule.match[key] = defaultValue(key);
}

export function setMonitor(rule, value) {
    if (value < 0)
        delete rule.monitor;
    else
        rule.monitor = value;
}

export function setFlag(rule, flag, on) {
    if (on)
        rule[flag] = true;
    else
        delete rule[flag];
}

export function toggleSelected(draft, field, on) {
    let index = draft.selected.indexOf(field);

    if (on && index < 0)
        draft.selected.push(field);
    else if (!on && index >= 0)
        draft.selected.splice(index, 1);
}

export function includedCount(drafts) {
    return drafts.filter(draft => draft.include).length;
}

export function additionsFromDrafts(drafts) {
    let seen = new Set();
    let additions = [];

    for (let draft of drafts) {
        if (!draft.include || draft.selected.length === 0)
            continue;

        let rule = Suggest.draftToRule(draft);
        let key = JSON.stringify(rule.match);

        if (seen.has(key))
            continue;

        seen.add(key);
        additions.push(rule);
    }

    return additions;
}

export function mergeAdditions(raw, additions) {
    let rules = Config.mergeRules(Array.isArray(raw.rules) ? raw.rules : [], additions);
    let error = Config.validate(Object.assign({}, raw, {rules}));

    return error ? {rules: null, error} : {rules, error: null};
}
