import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function prefsSuite({Config, PrefsModel: Model, Suggest, Dbus}, {check, print}) {
    print('preferences: ranges and regex values');

    check('a number formats as itself', Model.formatRange(800), '800');
    check('a closed range formats with two dots', Model.formatRange({min: 800, max: 1200}), '800..1200');
    check('an open range keeps the empty side', Model.formatRange({max: 1200}), '..1200');
    check('a number parses back to a number', Model.parseRange(' 800 '), 800);
    check('a closed range parses', Model.parseRange('800..1200'), {min: 800, max: 1200});
    check('an open lower bound parses', Model.parseRange('..1200'), {max: 1200});
    check('an open upper bound parses', Model.parseRange('800..'), {min: 800});
    check('text that is not a range is kept for validation to name', Model.parseRange('abc'), 'abc');
    check('a lone separator is kept for validation to name', Model.parseRange('..'), '..');
    check('range text survives a format/parse round trip',
        Model.parseRange(Model.formatRange({min: 10, max: 20})), {min: 10, max: 20});

    check('a plain string regex has no flags', Model.splitRegexValue('^a$'), {pattern: '^a$', flags: ''});
    check('an object regex splits into pattern and flags',
        Model.splitRegexValue({pattern: '\\.pdf$', flags: 'i'}), {pattern: '\\.pdf$', flags: 'i'});
    check('an object regex without flags has empty flags',
        Model.splitRegexValue({pattern: 'x'}), {pattern: 'x', flags: ''});
    check('empty flags collapse to a plain string', Model.buildRegexValue('x', ''), 'x');
    check('flags switch to the object form', Model.buildRegexValue('x', 'i'), {pattern: 'x', flags: 'i'});

    print('preferences: predicate defaults and keys');

    check('a regex predicate starts empty', Model.defaultValue('title'), '');
    check('a negated regex predicate starts empty', Model.defaultValue('titleNot'), '');
    check('a numeric predicate starts at zero', Model.defaultValue('width'), 0);
    check('a boolean predicate starts true', Model.defaultValue('maximized'), true);
    check('the negation suffix is stripped to find the field', Model.fieldOf('wmClassNot'), 'wmClass');
    check('a key without a suffix is its own field', Model.fieldOf('wmClass'), 'wmClass');
    check('keys already in the rule are not offered again',
        Model.availableKeys({match: {wmClass: 'x', title: 'y'}}).some(k => k === 'wmClass' || k === 'title'),
        false);
    check('the negated form of a used key is still offered',
        Model.availableKeys({match: {wmClass: 'x'}}).includes('wmClassNot'), true);
    check('every offered default is a valid predicate',
        Model.availableKeys({match: {}}).every(key => {
            let rule = {name: 'x', workspace: 1, match: {}};
            Model.addPredicate(rule, key);
            return Config.validate({rules: [rule]}) === null;
        }), true);

    print('preferences: editing rules');

    const names = rules => rules.map(rule => rule.name);
    const three = () => [{name: 'a'}, {name: 'b'}, {name: 'c'}];

    let rules = three();
    check('moving down swaps with the next rule',
        [Model.moveRule(rules, 0, 1), names(rules)], [true, ['b', 'a', 'c']]);
    rules = three();
    check('moving up swaps with the previous rule',
        [Model.moveRule(rules, 2, -1), names(rules)], [true, ['a', 'c', 'b']]);
    rules = three();
    check('the first rule cannot move up',
        [Model.moveRule(rules, 0, -1), names(rules)], [false, ['a', 'b', 'c']]);
    rules = three();
    check('the last rule cannot move down',
        [Model.moveRule(rules, 2, 1), names(rules)], [false, ['a', 'b', 'c']]);
    rules = three();
    check('an index outside the list is ignored',
        [Model.moveRule(rules, 9, -1), names(rules)], [false, ['a', 'b', 'c']]);

    rules = [{name: 'code', match: {wmClass: '^code$'}, workspace: 2}, {name: 'z'}];
    let copy = Model.duplicateRule(rules, 0);
    check('a duplicate lands right below the original and is renamed',
        names(rules), ['code', 'code-copy', 'z']);
    copy.match.wmClass = 'changed';
    check('a duplicate is a deep copy', rules[0].match.wmClass, '^code$');

    check('a new rule is named after the list length and validates',
        (() => {
            let list = [{}, {}];
            let rule = Model.newRule(list);
            return [rule.name, Config.validate({rules: [rule]}) === null];
        })(), ['rule-3', true]);

    let rule = {monitor: 1};
    Model.setMonitor(rule, -1);
    check('monitor -1 removes the key', rule, {});
    Model.setMonitor(rule, 0);
    check('monitor 0 is a real monitor', rule, {monitor: 0});

    rule = {};
    Model.setFlag(rule, 'follow', true);
    check('a switched-on flag is stored', rule, {follow: true});
    Model.setFlag(rule, 'follow', false);
    check('a switched-off flag is removed rather than stored as false', rule, {});

    check('a nameless rule is titled by position', Model.ruleTitle({}, 1), 'правило #2');
    check('a named rule is titled by its name', Model.ruleTitle({name: 'x'}, 1), 'x');

    print('preferences: snapshot drafts');

    const descriptor = (appId, title, workspace, id) => ({
        appId, wmClass: appId.replace('.desktop', ''), wmClassInstance: null, role: null, gtkAppId: null,
        title, workspace, id,
    });

    let drafts = Suggest.suggest([
        descriptor('code.desktop', 'a - containers - Visual Studio Code', 5, 1),
        descriptor('code.desktop', 'b - remote - Visual Studio Code', 6, 2),
        descriptor('kitty.desktop', 'shell', 3, 3),
    ]);
    for (let draft of drafts)
        draft.include = true;

    check('all ticked drafts are counted', Model.includedCount(drafts), 3);
    drafts[0].include = false;
    check('an unticked draft is not counted', Model.includedCount(drafts), 2);
    drafts[0].include = true;

    let additions = Model.additionsFromDrafts(drafts);
    check('every ticked draft becomes a rule', additions.length, 3);

    Model.toggleSelected(drafts[0], 'title', false);
    check('a predicate can be unticked', drafts[0].selected.includes('title'), false);
    Model.toggleSelected(drafts[0], 'title', false);
    check('unticking twice is harmless', drafts[0].selected.includes('title'), false);
    Model.toggleSelected(drafts[0], 'title', true);
    Model.toggleSelected(drafts[0], 'title', true);
    check('ticking twice does not duplicate the predicate',
        drafts[0].selected.filter(f => f === 'title').length, 1);

    drafts[1].selected = [];
    check('a draft without any predicate is skipped', Model.additionsFromDrafts(drafts).length, 2);

    let twins = Suggest.suggest([
        descriptor('kitty.desktop', 'one', 3, 1),
        descriptor('kitty.desktop', 'two', 3, 2),
    ]);
    for (let draft of twins)
        draft.include = true;
    check('drafts with an identical match collapse into one rule',
        Model.additionsFromDrafts(twins).length, 1);

    let merged = Model.mergeAdditions({rules: [], settleMs: 3000}, Model.additionsFromDrafts(drafts));
    check('merging valid drafts succeeds', [merged.error, merged.rules.length], [null, 2]);

    let bad = Model.mergeAdditions({rules: []}, [{name: 'x', match: {title: '('}, workspace: 1}]);
    check('an addition the extension would reject is refused with the rule named',
        [bad.rules, bad.error.includes('"x"')], [null, true]);

    let original = {rules: [{name: 'k', match: {wmClass: '^k$'}, workspace: 1}]};
    Model.mergeAdditions(original, [{name: 'n', match: {wmClass: '^n$'}, workspace: 2}]);
    check('merging does not mutate the current config', original.rules.length, 1);

    print('preferences: rules.json round trip');

    let dir = GLib.dir_make_tmp('mwa-test-XXXXXX');
    let path = GLib.build_filenamev([dir, 'nested', 'rules.json']);
    let config = {settleMs: 2345, debug: true, rules: [
        {name: 'a', match: {wmClass: {pattern: '^a$', flags: 'i'}, width: {min: 1, max: 2}}, workspace: 2, follow: true},
    ]};

    check('writing creates missing parent directories', Config.writePath(path, config), null);
    check('the written file reads back identically', Config.readPath(path), {raw: config, error: null});
    check('the file ends with a newline',
        new TextDecoder().decode(GLib.file_get_contents(path)[1]).endsWith('}\n'), true);

    let invalidPath = GLib.build_filenamev([dir, 'invalid.json']);
    Config.writePath(invalidPath, {rules: [{name: 'broken', match: {title: '('}, workspace: 1}]});
    let invalid = Config.readPath(invalidPath);
    check('a config the extension would reject is reported with the rule name',
        [invalid.raw !== null, invalid.error.includes('"broken"')], [true, true]);

    let garbagePath = GLib.build_filenamev([dir, 'garbage.json']);
    GLib.file_set_contents(garbagePath, '{ "rules": [ ');
    check('broken JSON is reported against the file',
        Config.readPath(garbagePath).error.includes('garbage.json'), true);

    let arrayPath = GLib.build_filenamev([dir, 'array.json']);
    GLib.file_set_contents(arrayPath, '[]');
    check('a non-object document is rejected', Config.readPath(arrayPath).error.includes('JSON object'), true);

    check('a missing file is reported, not thrown',
        Config.readPath(GLib.build_filenamev([dir, 'absent.json'])).error.includes('absent.json'), true);

    check('an unwritable path yields an error string',
        typeof Config.writePath('/proc/mwa/rules.json', config), 'string');

    check('the default config is valid', Config.validate(Config.defaultConfig()), null);

    check('a settleMs below the minimum is refused by validation',
        Config.validate({settleMs: 1999, rules: []}) !== null, true);
    check('a settleMs at the minimum passes validation',
        Config.validate({settleMs: 2000, rules: []}), null);

    let shortPath = GLib.build_filenamev([dir, 'short.json']);
    GLib.file_set_contents(shortPath, '{"settleMs": 1500, "rules": []}');
    let short = Config.readPath(shortPath);
    check('a file with a too small settleMs is reported as invalid',
        [short.raw !== null, short.error.includes('"settleMs"')], [true, true]);

    check('a rule is described by predicates and target',
        Config.describeRule({match: {wmClass: '^a$', width: {min: 1, max: 2}, maximized: true},
            workspace: 2, monitor: 1, follow: true, focus: true}),
        'wmClass ~ ^a$; width {"min":1,"max":2}; maximized = true → workspace 2, monitor 1, follow, focus');
    check('a rule without predicates says so', Config.describeRule({match: {}, workspace: 1}),
        'нет предикатов → workspace 1');

    GLib.spawn_command_line_sync(`rm -rf ${GLib.shell_quote(dir)}`);

    print('D-Bus contract shared by the shell and the preferences window');

    let node = Gio.DBusNodeInfo.new_for_xml(Dbus.INTERFACE);
    let iface = node.lookup_interface(Dbus.NAME);
    check('the interface XML parses and is named like the bus name', iface !== null, true);
    check('ListWindows returns one JSON string',
        iface.lookup_method('ListWindows').out_args.map(a => [a.name, a.signature]), [['json', 's']]);
    check('Reload returns a flag and a message',
        iface.lookup_method('Reload').out_args.map(a => [a.name, a.signature]), [['ok', 'b'], ['message', 's']]);
    check('the object path matches the interface name', Dbus.PATH, `/${Dbus.NAME.replace(/\./g, '/')}`);
}
