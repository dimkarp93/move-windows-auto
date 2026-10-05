import * as Cli from '../tools/cli.js';

export function cliSuite({check, checkThrows, print}) {
    print('command line helpers');

    const kitty = {id: 7, workspace: 2, appId: 'kitty.desktop', wmClass: 'kitty', title: 'a.b (1)', width: 800, height: 600};

    check('a skeleton matches by appId when it is known',
        Cli.skeleton(kitty),
        {name: 'CHANGE-ME', match: {appId: '^kitty\\.desktop$', title: 'a\\.b \\(1\\)'}, workspace: 1});

    check('a skeleton falls back to wmClass',
        Cli.skeleton({wmClass: 'Code', title: ''}).match,
        {wmClass: '^Code$', title: ''});

    check('the skeleton text is indented JSON',
        Cli.skeletonText({name: 'x'}).split('\n').slice(2),
        ['    {', '      "name": "x"', '    }']);

    check('a window description lists missing fields as <none>',
        Cli.describeWindow(kitty).split('\n').slice(0, 5),
        ['observed window 7 (workspace 2)',
            '  appId            kitty.desktop',
            '  wmClass          kitty',
            '  wmClassInstance  <none>',
            '  role             <none>']);

    check('the windows table has a header and one row per window',
        Cli.windowsTable([kitty]).split('\n').map(line => line.split(/\s+/).slice(0, 3)),
        [['ID', 'WS', 'APPID'], ['7', '2', 'kitty.desktop']]);

    const draft = {name: 'CHANGE-ME', match: {appId: '^code\\.desktop$', title: 'containers'}, workspace: 1};
    const generic = {name: 'code', match: {appId: '^code\\.desktop$'}, workspace: 1};

    check('a rule with the same match is replaced and keeps its name',
        Cli.addRule({rules: [generic]}, draft, {name: 'code-new', workspace: 3}).where,
        'replaced rule #1, it keeps the name "code"');

    check('a new rule drops the title by default and replaces the same match',
        Cli.addRule({rules: [generic]}, draft, {name: 'code', workspace: 3, keepTitle: false}).where,
        'replaced rule #1');

    let kept = Cli.addRule({rules: [generic]}, draft, {name: 'code-containers', workspace: 5, keepTitle: true});
    check('a rule that keeps its title goes above the general one',
        [kept.where, kept.raw.rules.map(rule => rule.name)],
        ['inserted as rule #1, above the more general one', ['code-containers', 'code']]);

    check('an unrelated rule is appended',
        Cli.addRule({rules: [generic]}, {match: {wmClass: '^kitty$'}}, {name: 'kitty', workspace: 2}).where,
        'appended as rule #2');

    check('the other settings of the file are kept',
        Cli.addRule({debug: true, rules: []}, draft, {name: 'code', workspace: 1}).raw.debug,
        true);

    checkThrows('a name used by another match is refused',
        () => Cli.addRule({rules: [generic]}, {match: {wmClass: '^kitty$'}}, {name: 'code', workspace: 2}),
        'already used');

    checkThrows('a rule the extension would reject is refused',
        () => Cli.addRule({rules: []}, {match: {wmClass: '('}}, {name: 'bad', workspace: 2}),
        'bad');

    check('config info counts rules and reads debug',
        Cli.configInfo({debug: true, rules: [generic]}), {rules: 1, debug: true});

    check('a listed uuid needs no change', Cli.enabledWith(['a', 'b'], 'a'), null);
    check('a new uuid is appended', Cli.enabledWith(['a'], 'b'), ['a', 'b']);
}
