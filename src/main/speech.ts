import { app } from "electron"
import { join } from "path"
import { env, pipeline } from "@huggingface/transformers"
import type { AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers"
import type { SpeechModelStatus } from "../shared/speech"

// `small` (≈ 590 Mo avec ces quantifications, téléchargés une seule fois) transcrit bien mieux le français
// parlé, les noms propres et les termes techniques que `base`. `large-v3-turbo` ferait mieux encore mais
// pèse ≈ 760 Mo et, sur CPU, mettrait chaque segment de 10 s plus longtemps à transcrire que sa durée.
const MODEL_ID = "onnx-community/whisper-small"
export const SAMPLE_RATE = 16000
export const MAX_AUDIO_SECONDS = 60

/** Taille approximative du modèle choisi, pour que la barre ne saute pas quand les fichiers se révèlent un à un. */
const EXPECTED_BYTES = 600e6

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null
let status: SpeechModelStatus = { state: "idle", progress: 0 }
const listeners = new Set<(status: SpeechModelStatus) => void>()
const files = new Map<string, { loaded: number; total: number }>()
let lastEmit = 0

export function getStatus(): SpeechModelStatus {
  return status
}

export function onStatus(listener: (status: SpeechModelStatus) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setStatus(next: SpeechModelStatus, force = true): void {
  const now = Date.now()
  // Pendant le téléchargement, au plus ~4 mises à jour par seconde.
  if (!force && now - lastEmit < 250) return
  lastEmit = now
  status = next
  for (const listener of listeners) listener(next)
}

function onDownloadProgress(info: {
  status?: string
  file?: string
  loaded?: number
  total?: number
}): void {
  if (
    !info.file ||
    typeof info.loaded !== "number" ||
    typeof info.total !== "number" ||
    info.total <= 0
  )
    return
  files.set(info.file, { loaded: info.loaded, total: info.total })
  let loaded = 0
  let total = 0
  for (const entry of files.values()) {
    loaded += entry.loaded
    total += entry.total
  }
  const progress = Math.min(0.99, loaded / Math.max(total, EXPECTED_BYTES))
  setStatus({ state: "loading", progress }, false)
}

function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise) {
    // Téléchargé une seule fois depuis Hugging Face, puis relu depuis ce dossier : la transcription reste locale.
    env.cacheDir = join(app.getPath("userData"), "models")
    files.clear()
    setStatus({ state: "loading", progress: 0 })
    transcriberPromise = pipeline("automatic-speech-recognition", MODEL_ID, {
      dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
      progress_callback: onDownloadProgress,
    }) as Promise<AutomaticSpeechRecognitionPipeline>
    transcriberPromise.then(
      () => setStatus({ state: "ready", progress: 1 }),
      () => {
        transcriberPromise = null
        // Pas de détail brut (chemin, URL) vers le renderer : un message d'usage suffit.
        setStatus({
          state: "error",
          progress: 0,
          error: "Téléchargement du modèle de transcription impossible. Vérifiez la connexion.",
        })
      },
    )
  }
  return transcriberPromise
}

export async function prepare(): Promise<void> {
  await getTranscriber()
}

export async function transcribe(audio: Float32Array): Promise<string> {
  const transcriber = await getTranscriber()
  const output = await transcriber(audio, { language: "french", task: "transcribe" })
  const result = Array.isArray(output) ? output[0] : output
  const text = result.text.trim()
  return /\p{L}/u.test(text) ? text : ""
}
