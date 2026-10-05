#!/usr/bin/env -S gjs -m

import GLib from 'gi://GLib';

import {helpers, finish, print} from './harness.js';
import {coreSuite} from './core.js';
import {prefsSuite} from './prefs.js';
import {cliSuite} from './cli.js';

import * as EsmMatcher from '../src/lib/matcher.js';
import * as EsmRules from '../src/lib/rules.js';
import * as EsmSuggest from '../src/lib/suggest.js';
import * as EsmConfig from '../src/lib/config.js';
import * as EsmPrefsModel from '../src/lib/prefs_model.js';
import * as EsmDbus from '../src/lib/dbus.js';

const root = GLib.path_get_dirname(GLib.path_get_dirname(
    GLib.filename_from_uri(import.meta.url)[0]));
const legacyDir = GLib.build_filenamev([root, 'build', 'legacy43']);

const flavours = [{
    name: 'esm (src/lib)',
    libs: {
        Matcher: EsmMatcher,
        Rules: EsmRules,
        Suggest: EsmSuggest,
        Config: EsmConfig,
        PrefsModel: EsmPrefsModel,
        Dbus: EsmDbus,
    },
}];

if (GLib.file_test(legacyDir, GLib.FileTest.IS_DIR)) {
    imports.searchPath.unshift(legacyDir);
    flavours.push({
        name: 'legacy (build/legacy43)',
        libs: {
            Matcher: imports.lib.matcher,
            Rules: imports.lib.rules,
            Suggest: imports.lib.suggest,
            Config: imports.lib.config,
            PrefsModel: imports.lib.prefs_model,
            Dbus: imports.lib.dbus,
        },
    });
} else {
    print('build/legacy43 is missing, run `just build`; legacy flavour skipped\n');
}

for (let {name, libs} of flavours) {
    print(`##### ${name}`);
    coreSuite(libs, helpers);
    prefsSuite(libs, helpers);
    print('');
}

print('##### tools');
cliSuite(helpers);

finish();
