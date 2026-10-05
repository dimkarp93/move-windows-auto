import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Controller} from './lib/mover.js';

export default class MoveWindowsAutoExtension extends Extension {
    enable() {
        this._controller = new Controller({
            path: this.path,
            log: message => console.log(message),
        });
        this._controller.enable();
    }

    disable() {
        this._controller?.disable();
        this._controller = null;
    }
}
