# Terminal Macros

Des boutons pour lancer vos commandes dans un terminal VSCode : **barre d'état** (en bas), **panneau latéral** (icône terminal à gauche) et raccourci **`Ctrl+Alt+M`**.

## Panneau latéral

| Action | Comment |
|---|---|
| Exécuter | clic sur la macro |
| Ajouter / Réglages | boutons `+` et `⚙` en haut du panneau |
| Exécuter, arrêter, modifier, supprimer | icônes au survol de la macro |
| Réordonner | glisser-déposer (ou clic droit → Monter/Descendre) |
| Dupliquer, masquer de la barre d'état | clic droit |

Une macro dont le terminal tourne s'affiche en vert avec un `●` et compte dans le badge du panneau. Une suppression peut être annulée depuis la notification.

**Créer** (`+`) : nom → icône (galerie) → commande. **Modifier** (✎) : toutes les propriétés dans une liste (nom, icône, couleur, info-bulle, commande, dossier, terminal…), sauvegarde immédiate, `Échap` pour sortir.

## Scripts du projet

Les fichiers `.bat`, `.cmd`, `.sh`, `.bash` et `.ps1` du dossier `scripts/` à la racine du projet apparaissent automatiquement dans le panneau — **chaque projet a donc ses propres commandes**, sans configuration. Clic pour exécuter (terminal ouvert à la racine du projet), clic droit pour ouvrir le fichier ou l'épingler comme macro (📌 il gagne alors son bouton dans la barre d'état).

## Réglages (`Ctrl+,` → « Terminal Macros »)

| Setting | Défaut | Rôle |
|---|---|---|
| `terminalMacros.buttons` | 2 exemples | Vos macros. Défini dans le `.vscode/settings.json` d'un projet, il ne s'applique qu'à ce projet. |
| `terminalMacros.detectProjectScripts` | `true` | Détection du dossier de scripts. |
| `terminalMacros.scriptsFolder` | `"scripts"` | Nom du dossier scanné. |
| `terminalMacros.scriptRunners` | `{}` | Lanceur par extension, `${script}` = le fichier. Ex. `{ "sh": "wsl bash \"${script}\"" }`. |

```json
"terminalMacros.buttons": [
    { "label": "$(play) Dev", "command": "npm run dev" },
    { "label": "$(rocket) Docker", "command": "docker compose up", "cwd": "${workspaceFolder}" }
]
```

| Propriété | Rôle |
|---|---|
| `label` ✅ | Texte du bouton, avec [codicon](https://microsoft.github.io/vscode-codicons/dist/codicon.html) optionnel : `$(play) Dev`. |
| `command` ✅ | Commande shell. Supporte `${workspaceFolder}` et `${file}`. |
| `tooltip` | Info-bulle au survol. |
| `cwd` | Répertoire de travail du terminal. |
| `terminalName` | Nom du terminal (défaut : le label sans icône). |
| `reuseTerminal` | `false` = nouveau terminal à chaque clic (défaut : réutilise). |
| `color` | `#ffcc00` ou une couleur de thème (`statusBarItem.warningForeground`). |
| `showInStatusBar` | `false` = macro visible seulement dans le panneau. |

## Installation

Lancer `scripts/install.bat` : l'extension est empaquetée puis installée. Recharger ensuite VSCode (`Ctrl+Shift+P` → « Reload Window »).

```powershell
npx --yes @vscode/vsce package -o terminal-macros.vsix
code --install-extension .\terminal-macros.vsix --force
```

Pour développer : ouvrir le dossier dans VSCode et appuyer sur `F5`.
