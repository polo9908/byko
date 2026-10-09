/** État du modèle de transcription local (téléchargé une seule fois). Contrat : `main/speech.ts`. */
export interface SpeechModelStatus {
  state: "idle" | "loading" | "ready" | "error"
  /** 0 → 1, estimé sur les octets téléchargés ; 1 seulement quand le modèle est chargé. */
  progress: number
  /** Message lisible, seulement si `state === "error"`. */
  error?: string
}
