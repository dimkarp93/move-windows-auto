import GLib from 'gi://GLib';

export function coreSuite({Matcher, Rules, Suggest, Config}, {check, checkThrows, print}) {
    function win(overrides) {
        return Object.assign({
            appId: null,
            wmClass: null,
            wmClassInstance: null,
            role: null,
            gtkAppId: null,
            windowType: 'normal',
            cmdline: null,
            title: null,
            x: 0,
            y: 0,
            width: 1920,
            height: 1099,
            maximized: false,
            monitor: 0,
        }, overrides);
    }

    const FIREFOX_NORMAL = win({
        appId: 'firefox-esr.desktop',
        wmClass: 'firefox-esr',
        wmClassInstance: 'Navigator',
        role: 'browser',
        title: 'New chat - Claude — Mozilla Firefox',
    });

    const FIREFOX_PRIVATE = win({
        appId: 'firefox-esr.desktop',
        wmClass: 'firefox-esr',
        wmClassInstance: 'Navigator',
        role: 'browser',
        title: 'Birth chart — Приватный просмотр Mozilla Firefox',
    });

    const FIREFOX_EARLY = win({
        appId: 'firefox-esr.desktop',
        wmClass: 'firefox-esr',
        wmClassInstance: 'Navigator',
        role: 'browser',
        title: null,
    });

    const VSCODE_CONTAINERS = win({
        appId: 'code.desktop',
        wmClass: 'code',
        wmClassInstance: 'code',
        role: 'browser-window',
        title: 'install-remote - containers - Visual Studio Code',
    });

    const VSCODE_OTHER = win({
        appId: 'code.desktop',
        wmClass: 'code',
        wmClassInstance: 'code',
        role: 'browser-window',
        title: 'remote-init.sh - remote - Visual Studio Code',
    });

    const VSCODE_EARLY = win({
        appId: 'code.desktop',
        wmClass: 'code',
        wmClassInstance: 'code',
        role: 'browser-window',
        title: 'Visual Studio Code',
    });

    const EVINCE_PINNED = win({
        appId: 'org.gnome.Evince.desktop',
        wmClass: 'Evince',
        wmClassInstance: 'evince',
        gtkAppId: 'org.gnome.Evince',
        title: 'Building-Evolutionary-Architectures.pdf — Building Evolutionary Architectures',
    });

    const EVINCE_OTHER = win({
        appId: 'org.gnome.Evince.desktop',
        wmClass: 'Evince',
        wmClassInstance: 'evince',
        gtkAppId: 'org.gnome.Evince',
        title: 'some-other-paper.pdf — Some Other Paper',
    });

    const KITTY = win({
        appId: 'kitty.desktop',
        wmClass: 'kitty',
        wmClassInstance: 'kitty',
        title: 'dima@localhost:~',
    });

    const KITTY_UNRESOLVED = win({
        appId: null,
        wmClass: 'kitty',
        wmClassInstance: 'kitty',
        title: 'dima@localhost:~',
    });

    function loadDefaultConfig() {
        let root = GLib.path_get_dirname(GLib.path_get_dirname(
            GLib.filename_from_uri(import.meta.url)[0]));
        let path = GLib.build_filenamev([root, 'rules.default.json']);
        let [ok, bytes] = GLib.file_get_contents(path);
        if (!ok)
            throw new Error(`cannot read ${path}`);
        return Rules.parse(new TextDecoder().decode(bytes));
    }

    function decide(descriptor, config) {
        let {action, index} = Matcher.evaluate(descriptor, config.rules);
        return {action, rule: index >= 0 ? config.rules[index].name : null};
    }

    function settled(descriptor, config) {
        let index = Matcher.resolve(descriptor, config.rules);
        return index >= 0 ? config.rules[index].name : null;
    }

    print('default config against real window fixtures');
    const config = loadDefaultConfig();

    check('firefox private goes to its own rule',
        decide(FIREFOX_PRIVATE, config), {action: 'apply', rule: 'firefox-private'});
    check('firefox normal waits because firefox-private may still match',
        decide(FIREFOX_NORMAL, config), {action: 'wait', rule: 'firefox'});
    check('firefox normal settles on the generic rule',
        settled(FIREFOX_NORMAL, config), 'firefox');
    check('firefox without a title yet keeps waiting',
        decide(FIREFOX_EARLY, config), {action: 'wait', rule: 'firefox'});

    check('vscode project window matches its pinned rule',
        decide(VSCODE_CONTAINERS, config), {action: 'apply', rule: 'vscode-containers'});
    check('vscode other project waits for the pinned rules to fail',
        decide(VSCODE_OTHER, config), {action: 'wait', rule: 'code'});
    check('vscode other project settles on the generic rule',
        settled(VSCODE_OTHER, config), 'code');
    check('vscode before the project name appears keeps waiting',
        decide(VSCODE_EARLY, config), {action: 'wait', rule: 'code'});

    check('pinned pdf matches',
        decide(EVINCE_PINNED, config), {action: 'apply', rule: 'pdf-pinned'});
    check('other pdf has no rule at all and waits for the title',
        decide(EVINCE_OTHER, config), {action: 'wait', rule: null});
    check('other pdf is left in place once settled',
        settled(EVINCE_OTHER, config), null);

    check('kitty moves immediately, nothing more specific can match',
        decide(KITTY, config), {action: 'apply', rule: 'kitty'});
    check('kitty with an unresolved app waits for the tracker',
        decide(KITTY_UNRESOLVED, config), {action: 'wait', rule: null});
    check('kitty with an unresolved app matches nothing yet',
        settled(KITTY_UNRESOLVED, config), null);

    print('matcher semantics');

    const orderConfig = Rules.compile({
        rules: [
            {name: 'specific', match: {wmClass: '^code$', title: 'alpha'}, workspace: 4},
            {name: 'generic', match: {wmClass: '^code$'}, workspace: 1},
        ],
    });

    check('a window matching nothing stable is dropped without waiting',
        decide(win({wmClass: 'kitty'}), orderConfig), {action: 'none', rule: null});
    check('negation matches when the field is absent',
        settled(win({wmClass: 'code', title: null}),
            Rules.compile({rules: [{name: 'n', match: {wmClass: '^code$', titleNot: 'alpha'}, workspace: 2}]})),
        'n');
    check('range predicate respects min and max',
        settled(win({wmClass: 'evince', width: 1500}),
            Rules.compile({rules: [{name: 'wide', match: {wmClass: '^evince$', width: {min: 1400}}, workspace: 9}]})),
        'wide');
    check('range predicate rejects out of bounds',
        settled(win({wmClass: 'evince', width: 900}),
            Rules.compile({rules: [{name: 'wide', match: {wmClass: '^evince$', width: {min: 1400}}, workspace: 9}]})),
        null);
    check('exact number is treated as a closed range',
        settled(win({wmClass: 'evince', monitor: 1}),
            Rules.compile({rules: [{name: 'second', match: {wmClass: '^evince$', monitor: 1}, workspace: 9}]})),
        'second');
    check('case insensitive flag is honoured',
        settled(win({wmClass: 'Evince', title: 'REPORT.PDF'}),
            Rules.compile({rules: [{name: 'ci', match: {wmClass: {pattern: '^evince$', flags: 'i'}, title: {pattern: '\\.pdf$', flags: 'i'}}, workspace: 9}]})),
        'ci');

    print('config validation');

    checkThrows('unknown predicate is rejected',
        () => Rules.compile({rules: [{name: 'x', match: {tittle: 'a'}, workspace: 1}]}),
        'unknown match key "tittle"');
    checkThrows('bad regex is rejected with the rule name',
        () => Rules.compile({rules: [{name: 'broken', match: {title: '('}, workspace: 1}]}),
        'rule "broken"');
    checkThrows('workspace must be a positive integer',
        () => Rules.compile({rules: [{name: 'x', match: {title: 'a'}, workspace: 0}]}),
        '"workspace" must be an integer >= 1');
    checkThrows('empty match is rejected',
        () => Rules.compile({rules: [{name: 'x', match: {}, workspace: 1}]}),
        'at least one predicate');
    checkThrows('negation on a numeric field is rejected',
        () => Rules.compile({rules: [{name: 'x', match: {widthNot: 10}, workspace: 1}]}),
        'negation only applies to regex fields');
    checkThrows('invalid JSON reports a parse error',
        () => Rules.parse('{'),
        'invalid JSON');

    checkThrows('settleMs below the minimum is rejected',
        () => Rules.compile({settleMs: Rules.MIN_SETTLE_MS - 1, rules: []}),
        `"settleMs" must be an integer >= ${Rules.MIN_SETTLE_MS}`);

    checkThrows('settleMs of zero is rejected',
        () => Rules.compile({settleMs: 0, rules: []}),
        '"settleMs"');

    checkThrows('a negative settleMs is rejected',
        () => Rules.compile({settleMs: -2500, rules: []}),
        '"settleMs"');

    checkThrows('a fractional settleMs is rejected',
        () => Rules.compile({settleMs: 2500.5, rules: []}),
        '"settleMs"');

    checkThrows('a settleMs given as text is rejected',
        () => Rules.compile({settleMs: '2500', rules: []}),
        '"settleMs"');

    checkThrows('a too small settleMs is rejected when parsing text as well',
        () => Rules.parse('{"settleMs": 1000, "rules": []}'),
        '"settleMs"');

    check('the minimum settleMs itself is accepted',
        Rules.compile({settleMs: Rules.MIN_SETTLE_MS, rules: []}).settleMs, Rules.MIN_SETTLE_MS);

    check('a larger settleMs is accepted',
        Rules.compile({settleMs: 7000, rules: []}).settleMs, 7000);

    check('the minimum is 2000 ms', Rules.MIN_SETTLE_MS, 2000);

    check('the default is not below the minimum', Rules.DEFAULT_SETTLE_MS >= Rules.MIN_SETTLE_MS, true);

    check('defaults are applied',
        (() => {
            let c = Rules.compile({rules: []});
            return {settleMs: c.settleMs, debug: c.debug, needsCmdline: c.needsCmdline, anyWindowType: c.anyWindowType};
        })(),
        {settleMs: Rules.DEFAULT_SETTLE_MS, debug: false, needsCmdline: false, anyWindowType: false});

    check('cmdline and windowType usage is detected',
        (() => {
            let c = Rules.compile({rules: [{name: 'x', match: {cmdline: 'foo', windowType: 'dialog'}, workspace: 1}]});
            return {needsCmdline: c.needsCmdline, anyWindowType: c.anyWindowType};
        })(),
        {needsCmdline: true, anyWindowType: true});

    print('snapshot suggestions');

    function snap(descriptor, workspace, id) {
        return Object.assign({}, descriptor, {workspace, id});
    }

    function rulesOf(drafts) {
        return drafts.map(Suggest.draftToRule);
    }

    check('one app on one workspace yields a single identity rule',
        rulesOf(Suggest.suggest([snap(KITTY, 3, 1), snap(KITTY, 3, 2)])),
        [
            {name: 'kitty', match: {appId: '^kitty\\.desktop$'}, workspace: 3},
            {name: 'kitty-2', match: {appId: '^kitty\\.desktop$'}, workspace: 3},
        ]);

    check('an app split across workspaces gets a distinguishing title suffix',
        rulesOf(Suggest.suggest([snap(VSCODE_CONTAINERS, 5, 1), snap(VSCODE_OTHER, 6, 2)])),
        [
            {
                name: 'code-containers',
                match: {
                    appId: '^code\\.desktop$',
                    title: ' - containers - Visual Studio Code$',
                },
                workspace: 5,
            },
            {
                name: 'code-remote',
                match: {
                    appId: '^code\\.desktop$',
                    title: ' - remote - Visual Studio Code$',
                },
                workspace: 6,
            },
        ]);

    check('specific drafts come before identity-only ones',
        Suggest.suggest([snap(KITTY, 3, 1), snap(VSCODE_CONTAINERS, 5, 2), snap(VSCODE_OTHER, 6, 3)])
            .map(draft => draft.specific),
        [true, true, false]);

    check('a window without an appId falls back to wmClass',
        rulesOf(Suggest.suggest([snap(KITTY_UNRESOLVED, 2, 1)])),
        [{name: 'kitty', match: {wmClass: '^kitty$'}, workspace: 2}]);

    check('every candidate predicate is offered for editing',
        Object.keys(Suggest.suggest([snap(EVINCE_PINNED, 3, 1)])[0].candidates),
        ['appId', 'wmClass', 'wmClassInstance', 'gtkAppId', 'title']);

    print('rule merging');

    const generic = {name: 'code', match: {appId: '^code\\.desktop$'}, workspace: 1};
    const specific = {
        name: 'code-containers',
        match: {appId: '^code\\.desktop$', title: ' - containers - Visual Studio Code$'},
        workspace: 5,
    };

    check('a specific rule is inserted above the general one',
        Config.mergeRules([generic], [specific]).map(rule => rule.name),
        ['code-containers', 'code']);

    check('an identical match is replaced in place, keeping its name',
        Config.mergeRules([generic], [{name: 'code-new', match: {appId: '^code\\.desktop$'}, workspace: 7}]),
        [{name: 'code', match: {appId: '^code\\.desktop$'}, workspace: 7}]);

    check('an unrelated rule is appended',
        Config.mergeRules([generic], [{name: 'kitty', match: {appId: '^kitty\\.desktop$'}, workspace: 3}])
            .map(rule => rule.name),
        ['code', 'kitty']);

    check('merged rules stay valid for the matcher',
        Config.validate({rules: Config.mergeRules([generic], [specific])}),
        null);

}
