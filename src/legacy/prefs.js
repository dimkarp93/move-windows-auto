const Me = imports.misc.extensionUtils.getCurrentExtension();
const PrefsWindow = Me.imports.lib.prefs_window;

function init() {
}

function fillPreferencesWindow(window) {
    PrefsWindow.fillWindow(window);
}
