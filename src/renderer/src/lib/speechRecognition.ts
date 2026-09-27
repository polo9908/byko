/**
 * Web Speech API : pas de types officiels dans lib.dom, on déclare le strict
 * nécessaire. Partagé entre B3 (Point d'équipe) et B4 (Parler à BCC).
 *
 * Limite connue : Electron n'embarque pas de moteur de reconnaissance vocale
 * comme Chrome (pas de clé Google Speech intégrée) — cette API échoue donc
 * souvent selon l'environnement. Les appelants doivent gérer `onerror` et
 * proposer un repli (texte tapé, etc.) plutôt que de supposer que ça marche.
 */
export interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: { transcript: string }
}
export interface SpeechRecognitionEventLike extends Event {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}
export interface SpeechRecognitionLike extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}
