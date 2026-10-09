# Contrat IPC — état du modèle de transcription

Le modèle Whisper local (`onnx-community/whisper-small`, ≈ 590 Mo) est téléchargé une seule fois dans
`userData/models`. L'état du téléchargement est exposé au renderer pour afficher une barre de progression.

| Canal | Sens | Paramètres | Retour |
| --- | --- | --- | --- |
| `speech:prepare` | renderer → main | aucun | `Promise<void>` (lance le chargement ; échoue si le téléchargement échoue, réessayable) |
| `speech:getStatus` | renderer → main | aucun | `SpeechModelStatus` |
| `speech:status` | main → renderer (événement) | — | `SpeechModelStatus`, ≤ ~4 par seconde pendant le téléchargement |

`SpeechModelStatus` (`src/shared/speech.ts`) : `{ state: "idle" | "loading" | "ready" | "error", progress: 0..1, error? }`.

- `progress` est estimé sur les octets reçus, avec une taille attendue de 600 Mo pour ne pas sauter ; il plafonne à
  0,99 tant que le modèle n'est pas chargé.
- `error` est un message d'usage : jamais de chemin, d'URL ni de trace brute.
- Aucune URL, aucun chemin ne vient du renderer. Preload : `api.speech.onStatus(cb)` renvoie le désabonnement et
  n'expose jamais l'objet `event` d'Electron.
