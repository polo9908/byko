import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { mountSoundUnlock } from "./lib/sound"
import { installPressPhysics } from "./lib/motion"
import { applyStoredAccessibilityPrefs } from "./lib/accessibility"
import "./styles/tokens.css"
import "./styles/motion.css"
import "./styles/accessibility.css"

// Les deux AudioContext du sound design (voir lib/sound.ts) ne peuvent démarrer
// que sur un geste de l'utilisateur : on branche le déverrouillage avant le rendu.
mountSoundUnlock()
// Taille, contraste, police… choisis dans Réglages > Accessibilité : appliqués avant le premier rendu.
applyStoredAccessibilityPrefs()
// Toute commande de l'app se comprime à la pression puis rebondit (ressort), y compris celles rendues plus tard.
installPressPhysics()

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
