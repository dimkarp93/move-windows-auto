export function activate(window, rule) {
    if (rule.follow) {
        let workspace = global.workspace_manager.get_workspace_by_index(rule.workspace - 1);
        if (workspace)
            workspace.activate(global.get_current_time());
    }

    if (rule.focus)
        window.activate(global.get_current_time());
}

export function place(window, rule, final) {
    let index = rule.workspace - 1;
    let count = global.workspace_manager.n_workspaces;
    if (index >= count)
        return `workspace ${rule.workspace} does not exist (${count} workspaces)`;

    if (rule.monitor !== null) {
        if (rule.monitor >= global.display.get_n_monitors())
            return `monitor ${rule.monitor} does not exist`;
        window.move_to_monitor(rule.monitor);
    }

    window.change_workspace_by_index(index, false);

    if (final)
        activate(window, rule);

    return null;
}
