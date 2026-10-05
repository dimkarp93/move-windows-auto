export const FIELDS = {
    appId: 'string',
    wmClass: 'string',
    wmClassInstance: 'string',
    role: 'string',
    gtkAppId: 'string',
    windowType: 'string',
    cmdline: 'string',
    title: 'string',
    x: 'range',
    y: 'range',
    width: 'range',
    height: 'range',
    monitor: 'range',
    maximized: 'bool',
};

export const ALWAYS_VOLATILE_FIELDS = new Set([
    'title', 'x', 'y', 'width', 'height', 'maximized', 'monitor',
]);

export function isVolatile(field, descriptor) {
    if (ALWAYS_VOLATILE_FIELDS.has(field))
        return true;
    if (field === 'appId')
        return descriptor.appId === null || descriptor.appId === undefined;
    return false;
}

function _predicateKeys() {
    let keys = [];
    for (let field in FIELDS) {
        keys.push(field);
        if (FIELDS[field] === 'string')
            keys.push(`${field}Not`);
    }
    return keys;
}

export const PREDICATE_KEYS = _predicateKeys();

export function isStringField(field) {
    return FIELDS[field] === 'string';
}

function _matchString(value, regex) {
    return typeof value === 'string' && regex.test(value);
}

function _matchRange(value, range) {
    if (typeof value !== 'number')
        return false;
    if (range.min !== undefined && value < range.min)
        return false;
    if (range.max !== undefined && value > range.max)
        return false;
    return true;
}

export function matchesField(descriptor, field, spec, negated) {
    let value = descriptor[field];
    let result;

    switch (FIELDS[field]) {
    case 'string':
        result = _matchString(value, spec);
        break;
    case 'range':
        result = _matchRange(value, spec);
        break;
    case 'bool':
        result = value === spec;
        break;
    default:
        result = false;
    }

    return negated ? !result : result;
}

function _testRule(descriptor, rule) {
    let stableOk = true;
    let volatileOk = true;

    for (let predicate of rule.predicates) {
        let ok = matchesField(descriptor, predicate.field, predicate.spec,
            predicate.negated);
        if (ok)
            continue;
        if (isVolatile(predicate.field, descriptor))
            volatileOk = false;
        else
            stableOk = false;
    }

    return {stableOk, volatileOk};
}

export function evaluate(descriptor, rules) {
    let firstMatch = -1;
    let firstPossible = -1;

    for (let i = 0; i < rules.length; i++) {
        let {stableOk, volatileOk} = _testRule(descriptor, rules[i]);
        if (!stableOk)
            continue;
        if (volatileOk) {
            if (firstMatch < 0)
                firstMatch = i;
        } else if (firstPossible < 0) {
            firstPossible = i;
        }
        if (firstMatch >= 0 && firstPossible >= 0)
            break;
    }

    if (firstMatch >= 0 && (firstPossible < 0 || firstMatch < firstPossible))
        return {action: 'apply', index: firstMatch, waitingFor: -1};

    if (firstMatch < 0 && firstPossible < 0)
        return {action: 'none', index: -1, waitingFor: -1};

    return {action: 'wait', index: firstMatch, waitingFor: firstPossible};
}

export function resolve(descriptor, rules) {
    for (let i = 0; i < rules.length; i++) {
        let {stableOk, volatileOk} = _testRule(descriptor, rules[i]);
        if (stableOk && volatileOk)
            return i;
    }
    return -1;
}

export function describeUnmatched(descriptor, rule) {
    let failed = [];
    for (let predicate of rule.predicates) {
        if (!matchesField(descriptor, predicate.field, predicate.spec,
            predicate.negated))
            failed.push(predicate.key);
    }
    return failed;
}
