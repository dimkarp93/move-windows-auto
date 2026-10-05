import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

export function iconButton(iconName, tooltip, onClick) {
    let button = new Gtk.Button({
        icon_name: iconName,
        tooltip_text: tooltip,
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });
    button.connect('clicked', onClick);
    return button;
}

export function spinRow(title, options) {
    let row = new Adw.ActionRow({title, subtitle: options.subtitle || null});
    let spin = new Gtk.SpinButton({
        valign: Gtk.Align.CENTER,
        numeric: true,
        adjustment: new Gtk.Adjustment({
            lower: options.min,
            upper: options.max,
            step_increment: options.step || 1,
            page_increment: options.step || 1,
            value: options.value,
        }),
    });

    spin.connect('value-changed', () => options.onChange(spin.get_value_as_int()));
    row.add_suffix(spin);
    row.activatable_widget = spin;

    return {row, spin};
}

export function switchRow(title, value, onChange, subtitle) {
    let row = new Adw.ActionRow({title, subtitle: subtitle || null});
    let toggle = new Gtk.Switch({active: value, valign: Gtk.Align.CENTER});

    toggle.connect('notify::active', () => onChange(toggle.active));
    row.add_suffix(toggle);
    row.activatable_widget = toggle;

    return {row, toggle};
}

export function entryRow(title, text, onChange) {
    let row = new Adw.EntryRow({title, text: text || ''});
    let guard = false;

    row.connect('changed', () => {
        if (!guard)
            onChange(row.get_text());
    });

    row.setTextQuietly = value => {
        guard = true;
        row.set_text(value);
        guard = false;
    };

    return row;
}

export function alert(parent, heading, body) {
    let dialog = new Adw.MessageDialog({
        transient_for: parent,
        modal: true,
        heading,
        body,
    });
    dialog.add_response('ok', 'Закрыть');
    dialog.present();
}

export function confirm(parent, heading, body, confirmLabel, onConfirm) {
    let dialog = new Adw.MessageDialog({
        transient_for: parent,
        modal: true,
        heading,
        body,
    });
    dialog.add_response('cancel', 'Отмена');
    dialog.add_response('confirm', confirmLabel);
    dialog.set_response_appearance('confirm', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.connect('response', (_dialog, response) => {
        if (response === 'confirm')
            onConfirm();
    });
    dialog.present();
}
