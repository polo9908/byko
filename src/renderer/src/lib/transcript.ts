/**
 * Recollage des segments de la transcription en direct. Chaque segment commence par quelques
 * secondes déjà entendues dans le précédent (voir `startLiveVoiceRecording`) : Whisper les retranscrit,
 * parfois un peu différemment. On retire du début du nouveau texte ce qui répète la fin du texte déjà
 * obtenu, pour que les décisions ne soient ni dites deux fois ni comptées deux fois.
 */

const MAX_OVERLAP_WORDS = 30

function normalize(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "")
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

/** Deux mots se valent s'ils sont identiques, ou — pour un mot assez long — à une lettre près (« Karim » / « Carim »). */
function sameWord(a: string, b: string): boolean {
  if (!a || !b) return false
  return a === b || (a.length >= 5 && b.length >= 5 && editDistanceAtMostOne(a, b))
}

/** Ajoute `next` à `previous` en retirant le début de `next` qui répète la fin de `previous`. */
export function appendSegment(previous: string, next: string): string {
  const nextTrimmed = next.trim()
  const prevTrimmed = previous.trim()
  if (!prevTrimmed) return nextTrimmed
  if (!nextTrimmed) return prevTrimmed

  const prevWords = prevTrimmed.split(/\s+/)
  const nextWords = nextTrimmed.split(/\s+/)
  const prevNorm = prevWords.map(normalize)
  const nextNorm = nextWords.map(normalize)

  let drop = 0
  // La jointure coupe parfois un mot : on tolère un mot en trop au bout de l'ancien texte, ou au début du nouveau.
  for (const tailSkip of [0, 1]) {
    for (const headSkip of [0, 1]) {
      const prevEnd = prevNorm.length - tailSkip
      const maxK = Math.min(MAX_OVERLAP_WORDS, prevEnd, nextNorm.length - headSkip)
      for (let k = maxK; k >= 2; k--) {
        let match = true
        for (let j = 0; j < k && match; j++) {
          match = sameWord(prevNorm[prevEnd - k + j], nextNorm[headSkip + j])
        }
        if (match) {
          drop = Math.max(drop, headSkip + k)
          break
        }
      }
    }
  }
  const rest = nextWords.slice(drop).join(" ")
  return rest ? `${prevTrimmed} ${rest}` : prevTrimmed
}
