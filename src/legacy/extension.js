const ExtensionUtils = imports.misc.extensionUtils;

const Me = ExtensionUtils.getCurrentExtension();
const Mover = Me.imports.lib.mover;

let controller = null;

function init() {
}

function enable() {
    controller = new Mover.Controller({
        path: Me.path,
        log: message => log(message),
    });
    controller.enable();
}

function disable() {
    if (controller) {
        controller.disable();
        controller = null;
    }
}
