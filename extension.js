const vscode = require('vscode');
const path = require('path');

/** @type {vscode.StatusBarItem[]} */
let statusBarItems = [];
/** @type {MacroTreeProvider} */
let treeProvider;
/** @type {vscode.TreeView} */
let treeView;
/** @type {vscode.FileSystemWatcher | undefined} */
let scriptWatcher;
/** Dernier résultat du scan des scripts projet. */
let cachedScripts = [];

/** Extensions de scripts détectées dans le dossier de scripts du projet. */
const SCRIPT_EXTS = ['bat', 'cmd', 'sh', 'bash', 'ps1'];

/** Codicons proposés dans la galerie d'icônes. */
const MACRO_ICONS = [
    'play', 'debug-start', 'run-all', 'terminal', 'rocket', 'zap', 'flame',
    'beaker', 'bug', 'tools', 'gear', 'package', 'archive', 'database',
    'server', 'server-process', 'cloud', 'cloud-upload', 'cloud-download',
    'globe', 'browser', 'sync', 'refresh', 'history', 'watch', 'shield',
    'key', 'lock', 'folder', 'folder-opened', 'file-code', 'code',
    'git-branch', 'git-merge', 'github', 'symbol-event', 'plug', 'pulse',
    'radio-tower', 'bell', 'star-full', 'heart', 'desktop-download',
    'circuit-board', 'vm', 'notebook',
];

/** Couleurs proposées pour les boutons de la barre d'état. */
const COLOR_CHOICES = [
    { label: '$(circle-slash) Par défaut', value: null },
    { label: '$(paintcan) Jaune', value: '#e2c08d' },
    { label: '$(paintcan) Orange', value: '#d18616' },
    { label: '$(paintcan) Rouge', value: '#f48771' },
    { label: '$(paintcan) Vert', value: '#89d185' },
    { label: '$(paintcan) Bleu', value: '#75beff' },
    { label: '$(paintcan) Cyan', value: '#29b8db' },
    { label: '$(paintcan) Violet', value: '#b180d7' },
    { label: '$(paintcan) Gris', value: '#8a8a8a' },
    { label: '$(warning) Avertissement (couleur du thème)', value: 'statusBarItem.warningForeground' },
    { label: '$(error) Erreur (couleur du thème)', value: 'statusBarItem.errorForeground' },
    { label: '$(edit) Personnalisée…', value: 'custom' },
];

const EXAMPLE_MACROS = [
    { label: '$(play) Dev', command: 'npm run dev', tooltip: 'Lancer le serveur de développement' },
    { label: '$(package) Install', command: 'npm install', tooltip: 'Installer les dépendances' },
    { label: '$(rocket) Docker Compose', command: 'docker compose up', cwd: '${workspaceFolder}', terminalName: 'Docker Compose' },
    { label: '$(git-branch) Git status', command: 'git status' },
];

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Retourne une copie mutable des macros valides de la configuration. */
function getConfiguredButtons() {
    const config = vscode.workspace.getConfiguration('terminalMacros');
    const raw = config.get('buttons', []);
    const valid = Array.isArray(raw)
        ? raw.filter((b) => b && typeof b.label === 'string' && typeof b.command === 'string')
        : [];
    // Copie profonde : les objets renvoyés par getConfiguration peuvent être gelés.
    return JSON.parse(JSON.stringify(valid));
}

/**
 * Écrit la liste des macros dans les settings (workspace si le setting y est
 * déjà défini, sinon settings utilisateur) puis rafraîchit l'interface.
 * @param {object[]} buttons
 */
async function saveButtons(buttons) {
    const config = vscode.workspace.getConfiguration('terminalMacros');
    const inspected = config.inspect('buttons');
    const target = inspected?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    await config.update('buttons', buttons, target);
    refreshAll();
}

/** Remplace les variables ${workspaceFolder} et ${file} dans une chaîne. */
function substituteVariables(text) {
    if (!text) {
        return text;
    }
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath ?? '';
    return text
        .replaceAll('${workspaceFolder}', workspaceFolder)
        .replaceAll('${file}', activeFile);
}

// ---------------------------------------------------------------------------
// Labels et icônes
// ---------------------------------------------------------------------------

/**
 * Sépare l'icône codicon éventuelle du texte d'un label.
 * @param {string} label
 * @returns {{ icon: string | undefined, text: string }}
 */
function parseLabel(label) {
    const match = /^\s*\$\(([^)]+)\)\s*(.*)$/.exec(label);
    if (match) {
        return { icon: match[1], text: match[2] };
    }
    return { icon: undefined, text: label };
}

/**
 * @param {string | null | undefined} icon
 * @param {string} text
 */
function composeLabel(icon, text) {
    return icon ? `$(${icon}) ${text}`.trim() : text;
}

/** Nom de terminal par défaut : le label sans les icônes codicon. */
function terminalNameFor(button) {
    if (button.terminalName) {
        return button.terminalName;
    }
    const cleaned = button.label.replace(/\$\([^)]*\)/g, '').trim();
    return cleaned || 'Terminal Macros';
}

/** Un terminal vivant porte-t-il ce nom ? */
function isRunningName(name) {
    return vscode.window.terminals.some((t) => t.name === name && t.exitStatus === undefined);
}

/** Une macro est « en cours » si un terminal vivant porte son nom. */
function isRunning(button) {
    return isRunningName(terminalNameFor(button));
}

// ---------------------------------------------------------------------------
// Scripts du projet (dossier scripts/ à la racine du workspace)
// ---------------------------------------------------------------------------

function scriptsFolderName() {
    const value = vscode.workspace.getConfiguration('terminalMacros').get('scriptsFolder', 'scripts');
    const cleaned = typeof value === 'string' ? value.trim().replace(/[\\/]+$/, '') : '';
    return cleaned || 'scripts';
}

/** Icône codicon selon l'extension du script. */
function iconForExt(ext) {
    if (ext === 'sh' || ext === 'bash') {
        return 'terminal-bash';
    }
    if (ext === 'ps1') {
        return 'terminal-powershell';
    }
    return 'terminal-cmd';
}

/** Modèle de commande de lancement par défaut selon la plateforme. */
function defaultRunner(ext) {
    if (ext === 'sh' || ext === 'bash') {
        return 'bash "${script}"';
    }
    if (process.platform === 'win32') {
        return '& "${script}"';
    }
    if (ext === 'ps1') {
        return 'pwsh -File "${script}"';
    }
    return undefined;
}

/**
 * Construit la commande shell qui lance un script, à partir du modèle
 * configuré (terminalMacros.scriptRunners) ou du modèle par défaut.
 * @returns {string | undefined}
 */
function buildScriptCommand(script) {
    const runners = vscode.workspace.getConfiguration('terminalMacros').get('scriptRunners', {});
    const template = (runners && typeof runners[script.ext] === 'string')
        ? runners[script.ext]
        : defaultRunner(script.ext);
    if (!template) {
        vscode.window.showWarningMessage(
            `Terminal Macros : aucun lanceur défini pour .${script.ext}. Configurez terminalMacros.scriptRunners.`
        );
        return undefined;
    }
    let scriptPath = script.uri.fsPath;
    // Git Bash préfère les slashs, même sous Windows.
    if ((script.ext === 'sh' || script.ext === 'bash') && process.platform === 'win32') {
        scriptPath = scriptPath.replaceAll('\\', '/');
    }
    return template.replaceAll('${script}', scriptPath);
}

/**
 * Scanne le dossier de scripts de chaque dossier du workspace.
 * Met à jour le cache utilisé par le badge et le QuickPick.
 * @returns {Promise<object[]>}
 */
async function findProjectScripts() {
    const config = vscode.workspace.getConfiguration('terminalMacros');
    if (!config.get('detectProjectScripts', true)) {
        cachedScripts = [];
        return [];
    }
    const folderName = scriptsFolderName();
    const results = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const pattern = new vscode.RelativePattern(folder, `${folderName}/**/*.{${SCRIPT_EXTS.join(',')}}`);
        let uris = [];
        try {
            uris = await vscode.workspace.findFiles(pattern, undefined, 200);
        } catch {
            uris = [];
        }
        const scriptsRoot = path.join(folder.uri.fsPath, folderName);
        for (const uri of uris) {
            const ext = uri.fsPath.split('.').pop().toLowerCase();
            results.push({
                uri,
                folder,
                ext,
                name: path.basename(uri.fsPath),
                rel: path.relative(scriptsRoot, uri.fsPath).split(path.sep).join('/'),
            });
        }
    }
    results.sort((a, b) => a.folder.name.localeCompare(b.folder.name) || a.rel.localeCompare(b.rel));
    cachedScripts = results;
    return results;
}

/** Lance un script projet dans un terminal ouvert à la racine du projet. */
function runScript(script) {
    if (!script || !script.uri) {
        return;
    }
    const command = buildScriptCommand(script);
    if (!command) {
        return;
    }
    let terminal = vscode.window.terminals.find(
        (t) => t.name === script.name && t.exitStatus === undefined
    );
    if (!terminal) {
        terminal = vscode.window.createTerminal({
            name: script.name,
            cwd: script.folder.uri.fsPath,
            iconPath: new vscode.ThemeIcon(iconForExt(script.ext)),
        });
    }
    terminal.show();
    terminal.sendText(command);
    refreshTree();
}

/** Ouvre le fichier d'un script dans l'éditeur. */
function openScript(arg) {
    const uri = arg?.script?.uri ?? (typeof arg === 'string' ? vscode.Uri.file(arg) : undefined);
    if (uri) {
        vscode.window.showTextDocument(uri);
    }
}

/** Épingle un script projet dans les macros configurées (et la barre d'état). */
async function pinScript(item) {
    const script = item?.script;
    if (!script) {
        return;
    }
    const command = buildScriptCommand(script);
    if (!command) {
        return;
    }
    const buttons = getConfiguredButtons();
    buttons.push({
        label: composeLabel(iconForExt(script.ext), script.name),
        command,
        cwd: script.folder.uri.fsPath,
        terminalName: script.name,
    });
    await saveButtons(buttons);
    vscode.window.showInformationMessage(
        `« ${script.name} » ajouté aux macros : il a maintenant son bouton dans la barre d'état.`
    );
}

// ---------------------------------------------------------------------------
// Exécution des macros
// ---------------------------------------------------------------------------

/** Ouvre (ou réutilise) un terminal et y exécute la commande de la macro. */
function runMacro(button) {
    if (!button || !button.command) {
        vscode.window.showWarningMessage('Terminal Macros : macro invalide (commande manquante).');
        return;
    }

    const name = terminalNameFor(button);
    const reuse = button.reuseTerminal !== false;
    const { icon } = parseLabel(button.label);

    let terminal;
    if (reuse) {
        terminal = vscode.window.terminals.find(
            (t) => t.name === name && t.exitStatus === undefined
        );
    }
    if (!terminal) {
        terminal = vscode.window.createTerminal({
            name,
            cwd: button.cwd ? substituteVariables(button.cwd) : undefined,
            iconPath: new vscode.ThemeIcon(icon ?? 'terminal'),
        });
    }

    terminal.show();
    terminal.sendText(substituteVariables(button.command));
    refreshTree();
}

/** Ferme le(s) terminal(aux) associé(s) à une macro ou un script. */
function stopItem(item) {
    const name = item?.button
        ? terminalNameFor(item.button)
        : item?.script?.name;
    if (!name) {
        return;
    }
    for (const t of vscode.window.terminals) {
        if (t.name === name) {
            t.dispose();
        }
    }
}

/** QuickPick de toutes les macros et scripts, avec bouton crayon pour éditer. */
async function pickMacro() {
    const buttons = getConfiguredButtons();
    const scripts = await findProjectScripts();
    const multiFolder = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;

    const qp = vscode.window.createQuickPick();
    qp.title = 'Terminal Macros';
    qp.placeholder = buttons.length || scripts.length
        ? 'Choisir une macro ou un script à exécuter'
        : 'Aucune macro configurée';
    qp.matchOnDescription = true;

    const items = buttons.map((b, index) => ({
        label: b.label,
        description: b.command + (isRunning(b) ? '  ●' : ''),
        index,
        button: b,
        buttons: [{ iconPath: new vscode.ThemeIcon('edit'), tooltip: 'Modifier cette macro' }],
    }));
    if (scripts.length) {
        items.push({ label: 'Scripts du projet', kind: vscode.QuickPickItemKind.Separator });
        for (const s of scripts) {
            items.push({
                label: `$(${iconForExt(s.ext)}) ${s.rel}`,
                description: (multiFolder ? s.folder.name : '') + (isRunningName(s.name) ? '  ●' : ''),
                script: s,
            });
        }
    }
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: '$(add) Ajouter une macro…', index: -1 });
    qp.items = items;

    qp.onDidTriggerItemButton((e) => {
        qp.hide();
        editMacro(e.item.index);
    });
    qp.onDidAccept(() => {
        const selected = qp.selectedItems[0];
        qp.hide();
        if (!selected) {
            return;
        }
        if (selected.script) {
            runScript(selected.script);
        } else if (selected.index === -1) {
            addMacro();
        } else {
            runMacro(selected.button);
        }
    });
    qp.onDidHide(() => qp.dispose());
    qp.show();
}

// ---------------------------------------------------------------------------
// Panneau latéral (TreeView + glisser-déposer)
// ---------------------------------------------------------------------------

const TREE_MIME = 'application/vnd.code.tree.terminalmacrosview';

class MacroTreeProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.dropMimeTypes = [TREE_MIME];
        this.dragMimeTypes = [TREE_MIME];
    }

    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element) {
        return element;
    }

    async getChildren(element) {
        if (!element) {
            const scripts = await findProjectScripts();
            updateBadge();
            if (!scripts.length) {
                return this._macroItems();
            }
            const groups = [this._groupItem('Macros', 'bookmark', 'macros')];
            const folders = [...new Set(scripts.map((s) => s.folder))];
            if (folders.length <= 1) {
                groups.push(this._groupItem('Scripts du projet', 'file-code', 'scripts', folders[0]));
            } else {
                for (const folder of folders) {
                    groups.push(this._groupItem(`Scripts — ${folder.name}`, 'file-code', 'scripts', folder));
                }
            }
            return groups;
        }
        if (element.kind === 'macros') {
            return this._macroItems();
        }
        if (element.kind === 'scripts') {
            return this._scriptItems(element.folder);
        }
        return [];
    }

    _groupItem(label, icon, kind, folder) {
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon(icon);
        item.contextValue = 'group';
        item.id = `group:${label}`;
        item.kind = kind;
        item.folder = folder;
        return item;
    }

    _macroItems() {
        return getConfiguredButtons().map((button, index) => {
            const { icon, text } = parseLabel(button.label);
            const running = isRunning(button);
            const hidden = button.showInStatusBar === false;

            const item = new vscode.TreeItem(text || button.label, vscode.TreeItemCollapsibleState.None);
            item.iconPath = running
                ? new vscode.ThemeIcon(icon ?? 'terminal', new vscode.ThemeColor('charts.green'))
                : new vscode.ThemeIcon(icon ?? 'terminal');
            item.description = button.command
                + (running ? '  ●' : '')
                + (hidden ? '  (masquée)' : '');

            const md = new vscode.MarkdownString('', true);
            md.isTrusted = true;
            md.appendMarkdown(`**${text || button.label}**${running ? ' — _en cours_' : ''}\n\n`);
            md.appendCodeblock(button.command, 'sh');
            if (button.cwd) {
                md.appendMarkdown(`$(folder) \`${button.cwd}\`\n\n`);
            }
            if (button.tooltip) {
                md.appendMarkdown(`${button.tooltip}\n\n`);
            }
            md.appendMarkdown(`[$(edit) Modifier](command:terminalMacros.edit?${encodeURIComponent(JSON.stringify([index]))})`);
            item.tooltip = md;

            item.contextValue = 'macro'
                + (running ? '-running' : '')
                + (hidden ? '-hidden' : '');
            item.command = {
                command: 'terminalMacros.run',
                title: 'Exécuter',
                arguments: [button],
            };
            item.button = button;
            item.index = index;
            return item;
        });
    }

    _scriptItems(folder) {
        return cachedScripts
            .filter((s) => !folder || s.folder === folder)
            .map((script) => {
                const running = isRunningName(script.name);
                const item = new vscode.TreeItem(script.rel, vscode.TreeItemCollapsibleState.None);
                item.iconPath = running
                    ? new vscode.ThemeIcon(iconForExt(script.ext), new vscode.ThemeColor('charts.green'))
                    : new vscode.ThemeIcon(iconForExt(script.ext));
                item.description = running ? '●' : undefined;

                const md = new vscode.MarkdownString('', true);
                md.isTrusted = true;
                md.appendMarkdown(`**${script.name}**${running ? ' — _en cours_' : ''}\n\n`);
                md.appendCodeblock(buildScriptCommand(script) ?? script.uri.fsPath, 'sh');
                md.appendMarkdown(`$(folder) \`${script.folder.uri.fsPath}\`\n\n`);
                md.appendMarkdown(`[$(go-to-file) Ouvrir le fichier](command:terminalMacros.openScript?${encodeURIComponent(JSON.stringify([script.uri.fsPath]))})`);
                item.tooltip = md;

                item.contextValue = 'script' + (running ? '-running' : '');
                item.command = {
                    command: 'terminalMacros.runScript',
                    title: 'Exécuter',
                    arguments: [{ script }],
                };
                item.script = script;
                return item;
            });
    }

    handleDrag(sources, dataTransfer) {
        const indices = sources
            .filter((s) => typeof s.index === 'number')
            .map((s) => s.index);
        if (indices.length) {
            dataTransfer.set(TREE_MIME, new vscode.DataTransferItem(indices));
        }
    }

    async handleDrop(target, dataTransfer) {
        const transferred = dataTransfer.get(TREE_MIME);
        if (!transferred) {
            return;
        }
        // Cible valide : une macro, le groupe Macros (→ fin de liste), ou rien.
        if (target && typeof target.index !== 'number' && target.kind !== 'macros') {
            return;
        }
        const dragged = [...transferred.value].sort((a, b) => a - b);
        const buttons = getConfiguredButtons();
        const moved = dragged.map((i) => buttons[i]).filter(Boolean);
        if (!moved.length) {
            return;
        }
        const targetIndex = typeof target?.index === 'number' ? target.index : buttons.length;
        const remaining = buttons.filter((_, i) => !dragged.includes(i));
        const offset = dragged.filter((i) => i < targetIndex).length;
        remaining.splice(targetIndex - offset, 0, ...moved);
        await saveButtons(remaining);
    }
}

// ---------------------------------------------------------------------------
// Sélecteurs (icône, couleur, dossier)
// ---------------------------------------------------------------------------

/**
 * Galerie d'icônes codicon.
 * @returns {Promise<{ icon: string | null } | undefined>} undefined si annulé.
 */
async function pickIcon(current) {
    const items = [
        { label: '$(circle-slash) Aucune icône', icon: null },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        ...MACRO_ICONS.map((name) => ({
            label: `$(${name})  ${name}`,
            icon: name,
            description: current === name ? '(actuelle)' : undefined,
        })),
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(edit) Autre… (saisir un nom de codicon)', icon: 'custom' },
    ];
    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Choisir une icône pour le bouton',
        matchOnDescription: true,
        ignoreFocusOut: true,
    });
    if (!picked) {
        return undefined;
    }
    if (picked.icon === 'custom') {
        const name = await vscode.window.showInputBox({
            prompt: 'Nom du codicon (voir la liste sur microsoft.github.io/vscode-codicons)',
            placeHolder: 'ex. flame',
            value: current ?? '',
            ignoreFocusOut: true,
            validateInput: (v) => (/^[a-z0-9-]*$/.test(v) ? undefined : 'Nom de codicon invalide (lettres minuscules, chiffres, tirets)'),
        });
        if (name === undefined) {
            return undefined;
        }
        return { icon: name || null };
    }
    return { icon: picked.icon };
}

/**
 * Palette de couleurs pour la barre d'état.
 * @returns {Promise<{ color: string | null } | undefined>} undefined si annulé.
 */
async function pickColor(current) {
    const picked = await vscode.window.showQuickPick(
        COLOR_CHOICES.map((c) => ({
            ...c,
            description: c.value && c.value !== 'custom' ? c.value : undefined,
        })),
        { placeHolder: `Couleur du bouton dans la barre d'état${current ? ` (actuelle : ${current})` : ''}`, ignoreFocusOut: true }
    );
    if (!picked) {
        return undefined;
    }
    if (picked.value === 'custom') {
        const value = await vscode.window.showInputBox({
            prompt: 'Couleur hexadécimale (#rrggbb) ou identifiant de couleur de thème',
            placeHolder: '#ffcc00 ou statusBarItem.warningForeground',
            value: current ?? '',
            ignoreFocusOut: true,
            validateInput: (v) =>
                v === '' || /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) || /^[a-zA-Z]+(\.[a-zA-Z]+)+$/.test(v)
                    ? undefined
                    : 'Attendu : #rrggbb ou un identifiant de thème comme statusBarItem.warningForeground',
        });
        if (value === undefined) {
            return undefined;
        }
        return { color: value || null };
    }
    return { color: picked.value };
}

/**
 * Sélecteur de répertoire de travail.
 * @returns {Promise<{ cwd: string | null } | undefined>} undefined si annulé.
 */
async function pickCwd(current) {
    const picked = await vscode.window.showQuickPick(
        [
            { label: '$(root-folder) Racine du workspace', description: '${workspaceFolder}', value: '${workspaceFolder}' },
            { label: '$(folder-opened) Parcourir…', value: 'browse' },
            { label: '$(edit) Saisir un chemin…', value: 'custom' },
            { label: '$(circle-slash) Non défini', description: 'répertoire par défaut de VSCode', value: null },
        ],
        { placeHolder: `Répertoire de travail du terminal${current ? ` (actuel : ${current})` : ''}`, ignoreFocusOut: true }
    );
    if (!picked) {
        return undefined;
    }
    if (picked.value === 'browse') {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Choisir ce dossier',
        });
        if (!uris || !uris.length) {
            return undefined;
        }
        return { cwd: uris[0].fsPath };
    }
    if (picked.value === 'custom') {
        const value = await vscode.window.showInputBox({
            prompt: 'Chemin du répertoire de travail — supporte ${workspaceFolder}',
            placeHolder: '${workspaceFolder}/app',
            value: current ?? '',
            ignoreFocusOut: true,
        });
        if (value === undefined) {
            return undefined;
        }
        return { cwd: value || null };
    }
    return { cwd: picked.value };
}

// ---------------------------------------------------------------------------
// Création, édition, suppression
// ---------------------------------------------------------------------------

/** Assistant de création en 3 étapes : nom, icône, commande. */
async function addMacro() {
    const text = await vscode.window.showInputBox({
        title: 'Nouvelle macro — étape 1/3',
        prompt: 'Nom du bouton',
        placeHolder: 'Dev',
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() ? undefined : 'Le nom ne peut pas être vide'),
    });
    if (text === undefined) {
        return;
    }

    const iconResult = await pickIcon(undefined);
    if (iconResult === undefined) {
        return;
    }

    const command = await vscode.window.showInputBox({
        title: 'Nouvelle macro — étape 3/3',
        prompt: 'Commande shell à exécuter — supporte ${workspaceFolder} et ${file}',
        placeHolder: 'npm run dev',
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() ? undefined : 'La commande ne peut pas être vide'),
    });
    if (command === undefined) {
        return;
    }

    const button = { label: composeLabel(iconResult.icon, text.trim()), command: command.trim() };
    const buttons = getConfiguredButtons();
    buttons.push(button);
    await saveButtons(buttons);

    const choice = await vscode.window.showInformationMessage(
        `Macro « ${button.label} » créée.`,
        'Exécuter',
        'Modifier en détail'
    );
    if (choice === 'Exécuter') {
        runMacro(button);
    } else if (choice === 'Modifier en détail') {
        editMacro(buttons.length - 1);
    }
}

/** Ajoute les macros d'exemple à la configuration. */
async function addExamples() {
    const buttons = getConfiguredButtons();
    const existing = new Set(buttons.map((b) => b.label));
    const added = EXAMPLE_MACROS.filter((m) => !existing.has(m.label));
    if (!added.length) {
        vscode.window.showInformationMessage('Les macros d\'exemple sont déjà présentes.');
        return;
    }
    buttons.push(...JSON.parse(JSON.stringify(added)));
    await saveButtons(buttons);
    vscode.window.showInformationMessage(`${added.length} macro(s) d'exemple ajoutée(s).`);
}

/** QuickPick pour choisir une macro (utilisé quand une commande est appelée sans cible). */
async function chooseMacroIndex(placeHolder) {
    const buttons = getConfiguredButtons();
    if (!buttons.length) {
        vscode.window.showInformationMessage('Terminal Macros : aucune macro configurée.');
        return undefined;
    }
    const picked = await vscode.window.showQuickPick(
        buttons.map((b, index) => ({ label: b.label, description: b.command, index })),
        { placeHolder, ignoreFocusOut: true }
    );
    return picked?.index;
}

/**
 * Hub d'édition : toutes les propriétés dans un QuickPick sectionné.
 * Chaque modification est sauvegardée immédiatement ; Échap ou « Terminé » pour sortir.
 * @param {number | { index?: number } | undefined} arg index, item d'arbre, ou rien.
 */
async function editMacro(arg) {
    let index;
    if (typeof arg === 'number') {
        index = arg;
    } else if (arg && typeof arg.index === 'number') {
        index = arg.index;
    } else {
        index = await chooseMacroIndex('Quelle macro modifier ?');
    }
    if (index === undefined) {
        return;
    }

    for (;;) {
        const buttons = getConfiguredButtons();
        const b = buttons[index];
        if (!b) {
            return;
        }
        const { icon, text } = parseLabel(b.label);
        const none = '(non défini)';
        const sep = (label) => ({ label, kind: vscode.QuickPickItemKind.Separator });

        const choice = await vscode.window.showQuickPick(
            [
                sep('Bouton'),
                { key: 'text', label: '$(tag) Nom', description: text || b.label },
                { key: 'icon', label: `$(${icon ?? 'circle-slash'}) Icône`, description: icon ?? none },
                { key: 'color', label: '$(symbol-color) Couleur (barre d\'état)', description: b.color ?? '(par défaut)' },
                { key: 'tooltip', label: '$(comment) Info-bulle', description: b.tooltip ?? none },
                { key: 'visibility', label: b.showInStatusBar === false ? '$(eye) Afficher dans la barre d\'état' : '$(eye-closed) Masquer de la barre d\'état', description: b.showInStatusBar === false ? 'actuellement masquée' : 'actuellement visible' },
                sep('Exécution'),
                { key: 'command', label: '$(terminal) Commande', description: b.command },
                { key: 'cwd', label: '$(folder) Répertoire de travail', description: b.cwd ?? none },
                { key: 'terminalName', label: '$(window) Nom du terminal', description: b.terminalName ?? `(auto : ${terminalNameFor(b)})` },
                { key: 'reuseTerminal', label: '$(sync) Réutiliser le terminal', description: b.reuseTerminal === false ? 'non — nouveau terminal à chaque exécution' : 'oui' },
                sep('Actions'),
                { key: 'run', label: '$(play) Tester la macro' },
                { key: 'duplicate', label: '$(copy) Dupliquer' },
                { key: 'delete', label: '$(trash) Supprimer' },
                { key: 'done', label: '$(check) Terminé' },
            ],
            { title: `Modifier « ${b.label} »`, placeHolder: 'Choisir une propriété à modifier — Échap pour terminer', ignoreFocusOut: true }
        );
        if (!choice || choice.key === 'done') {
            return;
        }

        switch (choice.key) {
            case 'text': {
                const value = await vscode.window.showInputBox({
                    prompt: 'Nom du bouton',
                    value: text || b.label,
                    ignoreFocusOut: true,
                    validateInput: (v) => (v.trim() ? undefined : 'Le nom ne peut pas être vide'),
                });
                if (value === undefined) {
                    continue;
                }
                b.label = composeLabel(icon, value.trim());
                break;
            }
            case 'icon': {
                const result = await pickIcon(icon);
                if (result === undefined) {
                    continue;
                }
                b.label = composeLabel(result.icon, text || b.label);
                break;
            }
            case 'color': {
                const result = await pickColor(b.color);
                if (result === undefined) {
                    continue;
                }
                if (result.color) {
                    b.color = result.color;
                } else {
                    delete b.color;
                }
                break;
            }
            case 'tooltip': {
                const value = await vscode.window.showInputBox({
                    prompt: 'Info-bulle — vide pour supprimer',
                    value: b.tooltip ?? '',
                    ignoreFocusOut: true,
                });
                if (value === undefined) {
                    continue;
                }
                if (value) {
                    b.tooltip = value;
                } else {
                    delete b.tooltip;
                }
                break;
            }
            case 'visibility': {
                if (b.showInStatusBar === false) {
                    delete b.showInStatusBar;
                } else {
                    b.showInStatusBar = false;
                }
                break;
            }
            case 'command': {
                const value = await vscode.window.showInputBox({
                    prompt: 'Commande shell — supporte ${workspaceFolder} et ${file}',
                    value: b.command,
                    ignoreFocusOut: true,
                    validateInput: (v) => (v.trim() ? undefined : 'La commande ne peut pas être vide'),
                });
                if (value === undefined) {
                    continue;
                }
                b.command = value.trim();
                break;
            }
            case 'cwd': {
                const result = await pickCwd(b.cwd);
                if (result === undefined) {
                    continue;
                }
                if (result.cwd) {
                    b.cwd = result.cwd;
                } else {
                    delete b.cwd;
                }
                break;
            }
            case 'terminalName': {
                const value = await vscode.window.showInputBox({
                    prompt: 'Nom du terminal — vide pour revenir au nom automatique',
                    value: b.terminalName ?? '',
                    ignoreFocusOut: true,
                });
                if (value === undefined) {
                    continue;
                }
                if (value) {
                    b.terminalName = value;
                } else {
                    delete b.terminalName;
                }
                break;
            }
            case 'reuseTerminal': {
                b.reuseTerminal = b.reuseTerminal === false;
                if (b.reuseTerminal) {
                    delete b.reuseTerminal;
                }
                break;
            }
            case 'run': {
                runMacro(b);
                continue;
            }
            case 'duplicate': {
                await duplicateMacro({ index });
                continue;
            }
            case 'delete': {
                await deleteMacro({ index });
                return;
            }
            default:
                continue;
        }
        await saveButtons(buttons);
    }
}

/** Supprime une macro, avec possibilité d'annuler depuis la notification. */
async function deleteMacro(item) {
    const buttons = getConfiguredButtons();
    const index = item?.index;
    if (index === undefined || !buttons[index]) {
        return;
    }
    const removed = buttons[index];
    buttons.splice(index, 1);
    await saveButtons(buttons);

    const choice = await vscode.window.showInformationMessage(
        `Macro « ${removed.label} » supprimée.`,
        'Annuler'
    );
    if (choice === 'Annuler') {
        const current = getConfiguredButtons();
        current.splice(Math.min(index, current.length), 0, removed);
        await saveButtons(current);
    }
}

/** Insère une copie de la macro juste après l'originale. */
async function duplicateMacro(item) {
    const buttons = getConfiguredButtons();
    const index = item?.index;
    if (index === undefined || !buttons[index]) {
        return;
    }
    const copy = JSON.parse(JSON.stringify(buttons[index]));
    const { icon, text } = parseLabel(copy.label);
    copy.label = composeLabel(icon, `${text || copy.label} (copie)`);
    buttons.splice(index + 1, 0, copy);
    await saveButtons(buttons);
}

/** Déplace une macro d'un cran vers le haut ou le bas. */
async function moveMacro(item, delta) {
    const buttons = getConfiguredButtons();
    const i = item?.index;
    if (i === undefined || !buttons[i]) {
        return;
    }
    const j = i + delta;
    if (j < 0 || j >= buttons.length) {
        return;
    }
    [buttons[i], buttons[j]] = [buttons[j], buttons[i]];
    await saveButtons(buttons);
}

/** Affiche/masque une macro dans la barre d'état. */
async function setStatusBarVisibility(item, visible) {
    const buttons = getConfiguredButtons();
    const index = item?.index;
    if (index === undefined || !buttons[index]) {
        return;
    }
    if (visible) {
        delete buttons[index].showInStatusBar;
    } else {
        buttons[index].showInStatusBar = false;
    }
    await saveButtons(buttons);
}

// ---------------------------------------------------------------------------
// Barre d'état
// ---------------------------------------------------------------------------

function createButtons() {
    for (const item of statusBarItems) {
        item.dispose();
    }
    statusBarItems = [];

    const buttons = getConfiguredButtons();
    // Priorités décroissantes pour garder l'ordre de la configuration.
    let priority = 1000;
    buttons.forEach((button, index) => {
        if (button.showInStatusBar === false) {
            return;
        }
        const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority--);
        item.text = button.label;

        const { text } = parseLabel(button.label);
        const md = new vscode.MarkdownString('', true);
        md.isTrusted = true;
        md.appendMarkdown(`**${text || button.label}**\n\n`);
        md.appendCodeblock(button.command, 'sh');
        if (button.cwd) {
            md.appendMarkdown(`$(folder) \`${button.cwd}\`\n\n`);
        }
        if (button.tooltip) {
            md.appendMarkdown(`${button.tooltip}\n\n`);
        }
        md.appendMarkdown(`[$(edit) Modifier](command:terminalMacros.edit?${encodeURIComponent(JSON.stringify([index]))})`);
        item.tooltip = md;

        item.command = {
            command: 'terminalMacros.run',
            title: button.label,
            arguments: [button],
        };
        if (button.color) {
            item.color = button.color.startsWith('#')
                ? button.color
                : new vscode.ThemeColor(button.color);
        }
        item.show();
        statusBarItems.push(item);
    });
}

// ---------------------------------------------------------------------------
// Rafraîchissement
// ---------------------------------------------------------------------------

/** Badge sur l'icône du panneau : nombre de macros/scripts en cours. */
function updateBadge() {
    if (!treeView) {
        return;
    }
    const running = getConfiguredButtons().filter(isRunning).length
        + cachedScripts.filter((s) => isRunningName(s.name)).length;
    treeView.badge = running
        ? { value: running, tooltip: `${running} terminal(aux) de macro en cours` }
        : undefined;
}

/** Rafraîchit le panneau latéral et le badge. */
function refreshTree() {
    treeProvider?.refresh();
    updateBadge();
}

/** Rafraîchit toute l'interface (barre d'état + panneau). */
function refreshAll() {
    createButtons();
    refreshTree();
}

/** (Re)crée le watcher qui suit le dossier de scripts du projet. */
function setupScriptWatcher() {
    scriptWatcher?.dispose();
    scriptWatcher = vscode.workspace.createFileSystemWatcher(`**/${scriptsFolderName()}/**`);
    scriptWatcher.onDidCreate(() => refreshTree());
    scriptWatcher.onDidDelete(() => refreshTree());
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    treeProvider = new MacroTreeProvider();
    treeView = vscode.window.createTreeView('terminalMacrosView', {
        treeDataProvider: treeProvider,
        dragAndDropController: treeProvider,
    });
    setupScriptWatcher();

    context.subscriptions.push(
        treeView,
        vscode.commands.registerCommand('terminalMacros.run', runMacro),
        vscode.commands.registerCommand('terminalMacros.pick', pickMacro),
        vscode.commands.registerCommand('terminalMacros.add', addMacro),
        vscode.commands.registerCommand('terminalMacros.addExamples', addExamples),
        vscode.commands.registerCommand('terminalMacros.edit', editMacro),
        vscode.commands.registerCommand('terminalMacros.duplicate', duplicateMacro),
        vscode.commands.registerCommand('terminalMacros.delete', deleteMacro),
        vscode.commands.registerCommand('terminalMacros.moveUp', (item) => moveMacro(item, -1)),
        vscode.commands.registerCommand('terminalMacros.moveDown', (item) => moveMacro(item, 1)),
        vscode.commands.registerCommand('terminalMacros.runFromTree', (item) => runMacro(item?.button)),
        vscode.commands.registerCommand('terminalMacros.stop', stopItem),
        vscode.commands.registerCommand('terminalMacros.hideFromStatusBar', (item) => setStatusBarVisibility(item, false)),
        vscode.commands.registerCommand('terminalMacros.showInStatusBar', (item) => setStatusBarVisibility(item, true)),
        vscode.commands.registerCommand('terminalMacros.runScript', (arg) => runScript(arg?.script ?? arg)),
        vscode.commands.registerCommand('terminalMacros.openScript', openScript),
        vscode.commands.registerCommand('terminalMacros.pinScript', pinScript),
        vscode.commands.registerCommand('terminalMacros.openSettings', () =>
            vscode.commands.executeCommand('workbench.action.openSettings', 'terminalMacros')
        ),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('terminalMacros')) {
                if (e.affectsConfiguration('terminalMacros.scriptsFolder')
                    || e.affectsConfiguration('terminalMacros.detectProjectScripts')) {
                    setupScriptWatcher();
                }
                refreshAll();
            }
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => refreshTree()),
        vscode.window.onDidOpenTerminal(() => refreshTree()),
        vscode.window.onDidCloseTerminal(() => refreshTree())
    );

    refreshAll();
}

function deactivate() {
    for (const item of statusBarItems) {
        item.dispose();
    }
    statusBarItems = [];
    scriptWatcher?.dispose();
    scriptWatcher = undefined;
}

module.exports = { activate, deactivate };
