const WHISPER_SAMPLE_RATE = 16000

const SILENCE_PEAK = 0.02

/** Whisper invente du texte (« Merci. », « ... ») sur un enregistrement muet : on ne le lui envoie pas. */
export function isSilent(audio: Float32Array): boolean {
  let peak = 0
  for (const sample of audio) peak = Math.max(peak, Math.abs(sample))
  return peak < SILENCE_PEAK
}

async function decodeToPcm(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: WHISPER_SAMPLE_RATE })
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    return decoded.getChannelData(0)
  } finally {
    await context.close()
  }
}

export interface VoiceRecording {
  /** Arrête l'enregistrement et renvoie l'audio mono en PCM 16 kHz, le format attendu par Whisper. */
  stop: () => Promise<Float32Array>
  cancel: () => void
}

export async function startVoiceRecording(): Promise<VoiceRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  recorder.start()

  function release(): void {
    stream.getTracks().forEach((track) => track.stop())
  }

  return {
    stop: () =>
      new Promise<Float32Array>((resolve, reject) => {
        recorder.onstop = async () => {
          release()
          try {
            resolve(await decodeToPcm(new Blob(chunks, { type: recorder.mimeType })))
          } catch (error) {
            reject(error)
          }
        }
        recorder.stop()
      }),
    cancel: () => {
      recorder.onstop = null
      if (recorder.state !== "inactive") recorder.stop()
      release()
    },
  }
}

export interface LiveVoiceRecording {
  stop: () => void
}

/**
 * Transcription "en direct" (B3) : pas de vrai streaming Whisper, mais des
 * segments successifs — un `MediaRecorder` redémarré toutes les `segmentMs`
 * sur le même flux micro, chaque segment étant un fichier WebM autonome donc
 * fiable à décoder, contrairement à un unique enregistrement fragmenté par
 * `timeslice`. `onSegment` est rappelé pour chaque segment non silencieux.
 */
export async function startLiveVoiceRecording(
  segmentMs: number,
  onSegment: (audio: Float32Array) => void,
): Promise<LiveVoiceRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  let stopped = false

  async function recordSegment(): Promise<void> {
    if (stopped) return
    const recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    const segmentEnded = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
    })
    recorder.start()
    await new Promise((resolve) => setTimeout(resolve, segmentMs))
    if (recorder.state !== "inactive") recorder.stop()
    await segmentEnded

    if (chunks.length > 0) {
      try {
        const audio = await decodeToPcm(new Blob(chunks, { type: recorder.mimeType }))
        if (!isSilent(audio)) onSegment(audio)
      } catch {
        // Segment illisible (trop court, coupé pile à l'arrêt) : ignoré, le suivant prendra le relais.
      }
    }
    void recordSegment()
  }

  void recordSegment()

  return {
    stop: () => {
      stopped = true
      stream.getTracks().forEach((track) => track.stop())
    },
  }
}
