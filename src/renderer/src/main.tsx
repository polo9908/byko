import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { mountSoundUnlock } from "./lib/sound"
import "./styles/tokens.css"

// Les deux AudioContext du sound design (voir lib/sound.ts) ne peuvent démarrer
// que sur un geste de l'utilisateur : on branche le déverrouillage avant le rendu.
mountSoundUnlock()

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
