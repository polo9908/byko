# Contrat IPC — Notifications (toast en bas à droite)

L'OS ne laisse pas choisir la durée d'une notification native : BYKO affiche sa propre petite fenêtre
(`src/main/notifications.ts`), qui reste le temps demandé. Durées autorisées (secondes) : 5, 10, 30, 60, 120.

| Canal | `window.api.*` | Entrée | Sortie |
|---|---|---|---|
| `notifications:show` | `notifications.show(payload)` | `{ title, body, durationSeconds, target?, highContrast?, reduceMotion? }` | `{ shown }` — `false` si l'app est au premier plan |
| `notifications:test` | `notifications.test(durationSeconds, { highContrast, reduceMotion })` | idem | `{ shown: true }` (même au premier plan) |

- Validation côté main : durée dans la liste blanche, textes non vides bornés (80 / 240 car.), booléens stricts.
- Le renderer n'envoie jamais de HTML, d'URL, de position ni de taille. Le texte est échappé.
- La fenêtre toast : `sandbox`, `contextIsolation`, pas de preload ni de script, CSP `default-src 'none'`, navigation refusée,
  non focalisable, au-dessus des autres fenêtres, coin bas-droit de l'écran principal, 3 empilées au plus.
- Un clic la ferme. Barre de décompte (supprimée si « Réduire les animations »).
- Aucune notification n'est encore émise par l'app : seul le bouton « Tester » des Réglages s'en sert.

## Zoom (preload)

`window.api.display.setZoom(factor)` → `webFrame.setZoomFactor`, borné à 0,8–2,0 dans le preload. Pas d'IPC.

## Clic sur le toast → page liée

- `target` (liste blanche : `day`, `pointdequipe`, `journal`, `settings`, `settings-accessibility` ; défaut `day`) est validé dans main.
- Au clic : le toast se ferme, main restaure/affiche/focalise la fenêtre de BYKO (recréée si elle avait été fermée) puis envoie
  `notifications:open` (main → renderer) avec la cible. Le renderer s'abonne via `window.api.notifications.onOpen(cb)` (le preload filtre
  la valeur ; `ipcRenderer` n'est jamais exposé) et ignore l'évènement pendant l'assistant de démarrage.
- « Tester la notification » ouvre Réglages > Accessibilité.
