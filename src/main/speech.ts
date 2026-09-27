import { app } from "electron"
import { join } from "path"
import { env, pipeline } from "@huggingface/transformers"
import type { AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers"

const MODEL_ID = "onnx-community/whisper-base"
export const SAMPLE_RATE = 16000
export const MAX_AUDIO_SECONDS = 60

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null

function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise) {
    // Téléchargé une seule fois depuis Hugging Face, puis relu depuis ce dossier : la transcription reste locale.
    env.cacheDir = join(app.getPath("userData"), "models")
    transcriberPromise = pipeline("automatic-speech-recognition", MODEL_ID, {
      dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
    }) as Promise<AutomaticSpeechRecognitionPipeline>
    transcriberPromise.catch(() => {
      transcriberPromise = null
    })
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
