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
  /**
   * Arrête le micro et attend que le dernier segment (celui en cours, même court) ait été remis à
   * `onSegment`. Idempotent : les appels suivants renvoient la même promesse.
   */
  stop: () => Promise<void>
}

/**
 * Transcription "en direct" (B3) : pas de vrai streaming Whisper, mais des segments successifs.
 * Chaque segment est un fichier WebM autonome (donc fiable à décoder, contrairement à un unique
 * enregistrement fragmenté par `timeslice`) et dure `segmentMs + overlapMs` : un nouveau segment
 * démarre toutes les `segmentMs`, avant la fin du précédent. Les `overlapMs` du recouvrement sont
 * donc entendus deux fois — un mot prononcé à la jointure n'est plus coupé en deux, et chaque
 * segment démarre avec un peu de contexte (l'appelant retire le texte en double, voir
 * `lib/transcript.ts`). `onSegment` reçoit les segments non silencieux, toujours dans l'ordre.
 */
export async function startLiveVoiceRecording(
  segmentMs: number,
  overlapMs: number,
  onSegment: (audio: Float32Array) => void,
): Promise<LiveVoiceRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const recorders: MediaRecorder[] = []
  const timers: ReturnType<typeof setTimeout>[] = []
  // Remise ordonnée : un segment court (le dernier) ne doit jamais passer avant le précédent.
  let delivery: Promise<void> = Promise.resolve()
  let stopped = false
  let stopping: Promise<void> | null = null

  function startSegment(): void {
    if (stopped) return
    const recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    const ended = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
    })
    const audio = ended.then(async (): Promise<Float32Array | null> => {
      if (chunks.length === 0) return null
      try {
        return await decodeToPcm(new Blob(chunks, { type: recorder.mimeType }))
      } catch {
        // Segment illisible (trop court, coupé pile à l'arrêt) : ignoré, les voisins couvrent la jointure.
        return null
      }
    })
    delivery = delivery.then(async () => {
      const pcm = await audio
      if (pcm && !isSilent(pcm)) onSegment(pcm)
    })
    recorders.push(recorder)
    recorder.start()
    timers.push(
      setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop()
      }, segmentMs + overlapMs),
    )
    timers.push(setTimeout(startSegment, segmentMs))
  }

  startSegment()

  return {
    stop: () => {
      if (!stopping) {
        stopped = true
        timers.forEach(clearTimeout)
        for (const recorder of recorders) if (recorder.state !== "inactive") recorder.stop()
        stream.getTracks().forEach((track) => track.stop())
        stopping = delivery
      }
      return stopping
    },
  }
}
