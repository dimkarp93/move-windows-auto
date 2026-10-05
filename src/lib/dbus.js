export const NAME = 'org.gnome.Shell.Extensions.MoveWindowsAuto';
export const PATH = '/org/gnome/Shell/Extensions/MoveWindowsAuto';

export const INTERFACE = `
<node>
  <interface name="${NAME}">
    <method name="ListWindows">
      <arg type="s" direction="out" name="json"/>
    </method>
    <method name="Reload">
      <arg type="b" direction="out" name="ok"/>
      <arg type="s" direction="out" name="message"/>
    </method>
  </interface>
</node>`;
