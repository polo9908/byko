/**
 * Les présents d'un point d'équipe (noms tirés de l'invitation Google Agenda) et leurs mentions dans
 * le compte rendu : chaque personne a sa couleur, le prénom cité dans un texte est surligné.
 * Tout reste dans le renderer : aucun nom n'est écrit sur disque en dehors du compte rendu local.
 */

/** Nombre de teintes (`person-mark--0…5` dans `people.css`) : rouge, orange, jaune, vert, bleu, violet. */
export const PERSON_COLORS = 6

export interface Mention {
  start: number
  end: number
  /** Index de la personne dans la liste des présents (donne la couleur). */
  person: number
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ""
}

export function colorOf(personIndex: number): number {
  return personIndex % PERSON_COLORS
}

/** Une lettre sans accent ni casse, toujours sur UN caractère : les index du texte replié restent ceux de l'original. */
function foldChar(char: string): string {
  const folded = char.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
  return folded.length === 1 ? folded : char.toLowerCase().slice(0, 1) || char
}

function fold(text: string): string {
  return Array.from(text, foldChar).join("")
}

const isLetter = (char: string | undefined): boolean => !!char && /\p{L}|\p{N}/u.test(char)

/** Les prénoms cités dans `text` (mot entier, sans accent ni casse), triés et sans chevauchement. */
export function findMentions(text: string, people: string[]): Mention[] {
  if (people.length === 0 || !text) return []
  const haystack = fold(text)
  const found: Mention[] = []
  people.forEach((name, person) => {
    const needle = fold(firstName(name))
    if (needle.length < 2) return
    let from = 0
    for (;;) {
      const at = haystack.indexOf(needle, from)
      if (at === -1) break
      from = at + needle.length
      if (isLetter(haystack[at - 1]) || isLetter(haystack[at + needle.length])) continue
      found.push({ start: at, end: at + needle.length, person })
    }
  })
  found.sort((a, b) => a.start - b.start)
  return found.filter((mention, i) => i === 0 || mention.start >= found[i - 1].end)
}

/** Les noms d'un compte rendu relu depuis le stockage local : texte court, sans adresse, en nombre borné. */
export function cleanPeople(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((name): name is string => typeof name === "string")
    .map((name) => name.trim().slice(0, 60))
    .filter((name) => name.length > 0 && !name.includes("@"))
    .slice(0, 30)
}
