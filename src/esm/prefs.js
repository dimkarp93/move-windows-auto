import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {fillWindow} from './lib/prefs_window.js';

export default class MoveWindowsAutoPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        fillWindow(window);
    }
}
