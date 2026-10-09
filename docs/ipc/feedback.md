# Contrat IPC — Retour utilisateur

Pastille « Un retour ? » en bas à gauche de tous les écrans (assistant de démarrage compris).

| Canal | `window.api.*` | Entrée | Sortie |
|---|---|---|---|
| `feedback:send` | `feedback.send(message)` | texte de 1 à 2 000 caractères | `void` |

- Byko n'a pas de serveur : main ouvre, dans le navigateur de l'utilisateur, un ticket GitHub **prérempli** sur
  `polo9908/byko`. L'utilisateur le relit et le valide lui-même ; **un compte GitHub est nécessaire**.
- Le texte reste dans le champ après l'envoi ; une adresse de plus de 6 000 caractères (texte long, accents, émojis) est
  refusée avec un message, car GitHub ne l'accepterait pas.
- L'adresse est une constante de `src/main/feedback.ts` : le renderer n'envoie que le texte, jamais d'URL.
- Joints au texte : la version de Byko et le système (`darwin arm64`…). Ni compte, ni e-mail, ni contenu de l'app.
- Les retours sont publics (dépôt public). Pour un autre destinataire (adresse e-mail, formulaire), changer `FEEDBACK_URL`
  et la construction de l'adresse dans `send`.
