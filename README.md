# Terminal Macros

Extension VSCode pour lancer des commandes personnalisées dans un terminal, via :

- des **boutons dans la barre d'état** (en bas de la fenêtre) ;
- un **panneau latéral « Terminal Macros »** (icône terminal dans la barre d'activité à gauche) qui permet de tout gérer sans toucher au JSON ;
- un **raccourci clavier** `Ctrl+Alt+M` qui liste toutes les macros.

## Panneau latéral

Cliquez sur l'icône terminal dans la barre d'activité (à gauche, comme l'explorateur de fichiers).

- **Clic sur une macro** : l'exécute dans un terminal.
- **Glisser-déposer** : réordonne les macros (et donc les boutons de la barre d'état).
- **`+` / `⚙`** (barre du panneau) : ajouter une macro / ouvrir les réglages.
- **Survol d'une macro** : icônes ▶ exécuter, ■ arrêter le terminal (si en cours), ✎ modifier, 🗑 supprimer.
- **Clic droit** : Exécuter, Arrêter, Monter/Descendre, Modifier, Dupliquer, Masquer de la barre d'état, Supprimer.
- **Macro en cours** : icône verte, point `●`, badge avec le nombre de macros actives sur l'icône du panneau.
- **Suppression** : immédiate, avec bouton **Annuler** dans la notification.

## Scripts du projet (configs par projet)

Si un dossier `scripts/` existe à la racine du projet ouvert, ses fichiers `.bat`, `.cmd`, `.sh`, `.bash` et `.ps1` (sous-dossiers inclus) apparaissent automatiquement dans le panneau, dans une section **« Scripts du projet »** — aucune configuration nécessaire, chaque projet a donc ses propres commandes.

- **Clic sur un script** : l'exécute dans un terminal ouvert à la racine du projet.
- **Icônes au survol / clic droit** : exécuter ▶, arrêter ■, ouvrir le fichier, **Ajouter aux macros** (📌 épingle le script comme macro : il gagne alors son bouton dans la barre d'état).
- La liste se met à jour automatiquement quand des scripts sont ajoutés ou supprimés.
- Les workspaces multi-dossiers sont supportés (une section par dossier).

Réglages associés :

| Setting | Défaut | Description |
|---|---|---|
| `terminalMacros.detectProjectScripts` | `true` | Active/désactive la détection. |
| `terminalMacros.scriptsFolder` | `"scripts"` | Nom du dossier scanné à la racine du projet. |
| `terminalMacros.scriptRunners` | `{}` | Commande de lancement par extension, `${script}` = chemin du fichier. Ex. `{ "sh": "wsl bash \"${script}\"" }`. Par défaut : `& "${script}"` pour .bat/.cmd/.ps1 et `bash "${script}"` pour .sh/.bash. |

À noter aussi : le setting `terminalMacros.buttons` peut être défini dans le `.vscode/settings.json` d'un projet pour avoir des **macros configurées propres à ce projet** (le panneau écrit alors dedans).

## Créer et modifier une macro

**Créer** (`+`) : assistant en 3 étapes — nom du bouton, choix de l'icône dans une galerie (~45 icônes, ou nom de codicon libre), commande shell.

**Modifier** (✎) : toutes les propriétés dans une liste organisée en sections, chaque modification étant sauvegardée immédiatement :

- **Bouton** : nom, icône (galerie), couleur (palette + couleur personnalisée), info-bulle, visibilité dans la barre d'état.
- **Exécution** : commande, répertoire de travail (racine du workspace, navigateur de dossiers ou chemin libre), nom du terminal, réutilisation du terminal.
- **Actions** : tester la macro, dupliquer, supprimer.

`Échap` ou « Terminé » pour sortir.

## Barre d'état

Chaque macro visible y a son bouton. Le survol affiche une info-bulle riche (commande, dossier, lien « Modifier »). Une macro peut être masquée de la barre d'état tout en restant dans le panneau (clic droit → « Masquer de la barre d'état »).

## Configuration manuelle (settings)

Les macros sont stockées dans le setting `terminalMacros.buttons`, modifiable aussi à la main (`Ctrl+,` → « Terminal Macros ») :

```json
"terminalMacros.buttons": [
    {
        "label": "$(play) Dev",
        "command": "npm run dev",
        "tooltip": "Lancer le serveur de développement"
    },
    {
        "label": "$(rocket) Docker Compose",
        "command": "docker compose up",
        "cwd": "${workspaceFolder}",
        "terminalName": "Docker Compose"
    }
]
```

L'interface se met à jour automatiquement dès que la configuration change. Le setting peut être défini par workspace (`.vscode/settings.json`) pour avoir des macros différentes par projet ; dans ce cas le panneau écrit dans le workspace.

### Propriétés d'une macro

| Propriété | Requis | Description |
|---|---|---|
| `label` | ✅ | Texte du bouton. Peut contenir une icône [codicon](https://microsoft.github.io/vscode-codicons/dist/codicon.html), ex. `$(play) Dev`. |
| `command` | ✅ | Commande shell exécutée dans le terminal. Supporte `${workspaceFolder}` et `${file}`. |
| `tooltip` | | Info-bulle au survol. |
| `terminalName` | | Nom du terminal créé/réutilisé (par défaut : le label sans icône). |
| `reuseTerminal` | | `true` par défaut : réutilise un terminal existant du même nom au lieu d'en ouvrir un nouveau à chaque clic. |
| `cwd` | | Répertoire de travail du terminal. Supporte `${workspaceFolder}`. |
| `color` | | Couleur du texte du bouton de barre d'état : hexadécimal (`#ffcc00`) ou couleur de thème (`statusBarItem.warningForeground`). |
| `showInStatusBar` | | `true` par défaut : `false` masque le bouton de la barre d'état (la macro reste dans le panneau). |

## Commandes (palette `Ctrl+Shift+P`)

- **Terminal Macros: Choisir une macro à exécuter** (`Ctrl+Alt+M`) — liste avec bouton crayon pour éditer, entrée « Ajouter une macro… ».
- **Terminal Macros: Ajouter une macro**
- **Terminal Macros: Modifier une macro**
- **Terminal Macros: Ajouter des macros d'exemple**
- **Terminal Macros: Ouvrir les réglages**

## Tester en développement

1. Ouvrir ce dossier dans VSCode.
2. Appuyer sur `F5` (« Lancer l'extension ») : une fenêtre *Extension Development Host* s'ouvre avec les macros d'exemple (bouton `Hello` et `Docker Compose`).

## Compiler et installer

Double-cliquer sur `install.bat` (ou l'exécuter dans un terminal). Il empaquette l'extension en `.vsix` puis l'installe dans VSCode. Recharger ensuite les fenêtres VSCode ouvertes (`Ctrl+Shift+P` → « Reload Window »).

Manuellement :

```powershell
npx --yes @vscode/vsce package --allow-missing-repository -o terminal-macros.vsix
code --install-extension .\terminal-macros.vsix --force
```
