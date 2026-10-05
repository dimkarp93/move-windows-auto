export const IDENTITY_FIELDS = ['appId', 'wmClass', 'wmClassInstance', 'role'];
export const CANDIDATE_FIELDS = ['appId', 'wmClass', 'wmClassInstance', 'role', 'gtkAppId', 'title'];

const SEPARATOR = /\s[-—–]\s/g;

export function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function anchor(value) {
    return `^${escapeRegex(value)}$`;
}

function _identityField(descriptor) {
    for (let field of IDENTITY_FIELDS) {
        if (typeof descriptor[field] === 'string' && descriptor[field] !== '')
            return field;
    }
    return null;
}

function _suffixes(title) {
    let offsets = [];
    SEPARATOR.lastIndex = 0;

    let match;
    while ((match = SEPARATOR.exec(title)) !== null)
        offsets.push(match.index);

    return offsets.reverse().map(offset => title.slice(offset));
}

export function titleSuffix(title, others) {
    for (let suffix of _suffixes(title)) {
        if (!others.some(other => other.endsWith(suffix)))
            return suffix;
    }
    return null;
}

export function titleRegex(title, others) {
    let suffix = titleSuffix(title, others);
    return suffix === null ? anchor(title) : `${escapeRegex(suffix)}$`;
}

function _slug(text) {
    let slug = String(text)
        .replace(/\.desktop$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return slug.slice(0, 40) || 'rule';
}

function _uniqueName(name, used) {
    if (!used.has(name)) {
        used.add(name);
        return name;
    }

    for (let n = 2; ; n++) {
        let candidate = `${name}-${n}`;
        if (!used.has(candidate)) {
            used.add(candidate);
            return candidate;
        }
    }
}

function _candidates(descriptor, siblingTitles) {
    let candidates = {};

    for (let field of CANDIDATE_FIELDS) {
        let value = descriptor[field];
        if (typeof value !== 'string' || value === '')
            continue;
        candidates[field] = field === 'title'
            ? titleRegex(value, siblingTitles)
            : anchor(value);
    }

    return candidates;
}

function _distinguisher(descriptor, siblingTitles) {
    let suffix = titleSuffix(descriptor.title || '', siblingTitles);
    if (suffix === null)
        return descriptor.title || '';

    SEPARATOR.lastIndex = 0;
    return suffix.split(SEPARATOR).filter(part => part !== '')[0] || suffix;
}

export function suggest(descriptors) {
    let groups = new Map();

    for (let descriptor of descriptors) {
        let field = _identityField(descriptor);
        if (!field)
            continue;

        let key = `${field} ${descriptor[field]}`;
        if (!groups.has(key))
            groups.set(key, {field, items: []});
        groups.get(key).items.push(descriptor);
    }

    let drafts = [];

    for (let group of groups.values()) {
        let split = new Set(group.items.map(d => d.workspace)).size > 1;

        for (let descriptor of group.items) {
            let siblings = group.items
                .filter(other => other !== descriptor)
                .map(other => other.title || '');
            let candidates = _candidates(descriptor, siblings);
            let selected = [group.field];

            if (split && candidates.title)
                selected.push('title');

            drafts.push({
                id: descriptor.id,
                descriptor,
                workspace: descriptor.workspace,
                identity: group.field,
                candidates,
                selected,
                specific: selected.includes('title'),
                base: _slug(descriptor[group.field]),
                extra: split ? _slug(_distinguisher(descriptor, siblings)) : '',
                name: '',
            });
        }
    }

    drafts.sort((a, b) => Number(b.specific) - Number(a.specific));

    let used = new Set();
    for (let draft of drafts)
        draft.name = _uniqueName(draft.extra ? `${draft.base}-${draft.extra}` : draft.base, used);

    return drafts;
}

export function draftToRule(draft) {
    let match = {};

    for (let field of CANDIDATE_FIELDS) {
        if (draft.selected.includes(field) && draft.candidates[field])
            match[field] = draft.candidates[field];
    }

    return {name: draft.name, match, workspace: draft.workspace};
}
