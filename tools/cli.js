import * as Config from '../src/lib/config.js';
import * as Suggest from '../src/lib/suggest.js';

const FIELDS = ['appId', 'wmClass', 'wmClassInstance', 'role', 'gtkAppId', 'title'];

const show = value => value === null || value === undefined || value === '' ? '<none>' : String(value);

export function skeleton(window) {
    let identity = window.appId ? 'appId' : 'wmClass';

    return {
        name: 'CHANGE-ME',
        match: {
            [identity]: Suggest.anchor(window[identity] ?? ''),
            title: Suggest.escapeRegex(window.title ?? ''),
        },
        workspace: 1,
    };
}

export function skeletonText(rule) {
    let body = JSON.stringify(rule, null, 2).split('\n').map(line => `    ${line}`).join('\n');
    return `rule skeleton, drop the predicates you do not need:\n\n${body}`;
}

export function describeWindow(window) {
    let lines = [`observed window ${window.id} (workspace ${window.workspace})`];

    for (let field of FIELDS)
        lines.push(`  ${field.padEnd(16)} ${show(window[field])}`);
    lines.push(`  ${'size'.padEnd(16)} ${window.width}x${window.height}`);
    lines.push(`  ${'cmdline'.padEnd(16)} ${show(window.cmdline)}`);

    return lines.join('\n');
}

export function windowsTable(windows) {
    let row = (id, ws, appId, wmClass, title) =>
        `${String(id).padEnd(10)} ${String(ws).padEnd(3)} ${appId.padEnd(24)} ${wmClass.padEnd(24)} ${title}`;

    return [
        row('ID', 'WS', 'APPID', 'WMCLASS', 'TITLE'),
        ...windows.map(w => row(w.id, w.workspace, w.appId || '-', w.wmClass || '-', w.title || '-')),
    ].join('\n');
}

export function addRule(raw, draft, {name, workspace, keepTitle}) {
    let match = Object.assign({}, draft.match);
    if (!keepTitle || !match.title)
        delete match.title;

    let rule = {name, match, workspace};
    let key = Config.matchKey(rule);
    let rules = Array.isArray(raw.rules) ? raw.rules : [];

    if (rules.some(r => r.name === name && Config.matchKey(r) !== key))
        throw new Error(`rule name "${name}" is already used by a rule with another match`);

    let replaced = rules.findIndex(r => Config.matchKey(r) === key);
    let merged = Config.mergeRules(rules, [rule]);
    let result = Object.assign({}, raw, {rules: merged});

    let error = Config.validate(result);
    if (error)
        throw new Error(error);

    let index, where;
    if (replaced >= 0) {
        index = replaced;
        where = `replaced rule #${index + 1}`;
        if (merged[index].name !== name)
            where += `, it keeps the name "${merged[index].name}"`;
    } else {
        index = merged.indexOf(rule);
        where = index === merged.length - 1
            ? `appended as rule #${index + 1}`
            : `inserted as rule #${index + 1}, above the more general one`;
    }

    return {raw: result, rule: merged[index], where};
}

export function configInfo(raw) {
    return {
        rules: Array.isArray(raw.rules) ? raw.rules.length : 0,
        debug: raw.debug === true,
    };
}

export function enabledWith(list, uuid) {
    return list.includes(uuid) ? null : [...list, uuid];
}
