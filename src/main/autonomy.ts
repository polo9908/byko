import { accountDataPath } from "./accountPaths"
import { mkdir, readFile, writeFile } from "fs/promises"
import { dirname } from "path"
import { AUTONOMY_MAX_LEVEL } from "../shared/autonomy"
import type { AutonomyCategory, AutonomyCategoryId } from "../shared/autonomy"

/**
 * Autonomie par catégorie (ticket C3), persistée en clair (préférence, pas
 * un secret) dans `userData/autonomy.json`. Les niveaux par défaut
 * reprennent l'état affiché dans le prototype — un point de départ éditable,
 * pas un historique d'usage réel : aucune action des intégrations n'est
 * encore rattachée à ces catégories (voir E7 pour le moteur de décision qui
 * consommera ces niveaux).
 */

const DEFAULTS: AutonomyCategory[] = [
  { id: "relances", label: "Relances", level: AUTONOMY_MAX_LEVEL },
  { id: "tickets-prets", label: "Tickets prêts", level: AUTONOMY_MAX_LEVEL },
  { id: "criteres-recette", label: "Critères de recette", level: 2 },
  { id: "alignement-figma", label: "Alignement Figma", level: 3 },
  // Passage d'un ticket à « terminé » quand ses pull requests sont fusionnées (voir linkSync.ts) : validé à la main au début.
  { id: "statut-tickets", label: "Statut des tickets", level: 2 },
]

/** Catégories derrière lesquelles une action existe réellement : les autres ne sont pas affichées tant que rien ne les consomme. */
const IMPLEMENTED: AutonomyCategoryId[] = ["statut-tickets"]

function autonomyFilePath(): string {
  return accountDataPath("autonomy.json")
}

async function readCategories(): Promise<AutonomyCategory[]> {
  try {
    const raw = await readFile(autonomyFilePath(), "utf-8")
    const stored = JSON.parse(raw) as AutonomyCategory[]
    // Une catégorie ajoutée depuis l'écriture du fichier apparaît avec son niveau par défaut.
    return [...stored, ...DEFAULTS.filter((category) => !stored.some((known) => known.id === category.id))]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULTS
    throw error
  }
}

async function writeCategories(categories: AutonomyCategory[]): Promise<void> {
  const file = autonomyFilePath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(categories))
}

export async function list(): Promise<AutonomyCategory[]> {
  return (await readCategories()).filter((category) => IMPLEMENTED.includes(category.id))
}

export async function setLevel(id: AutonomyCategoryId, level: number): Promise<AutonomyCategory[]> {
  const clamped = Math.max(0, Math.min(AUTONOMY_MAX_LEVEL, Math.round(level)))
  const categories = await readCategories()
  const next = categories.map((category) => (category.id === id ? { ...category, level: clamped } : category))
  await writeCategories(next)
  return next.filter((category) => IMPLEMENTED.includes(category.id))
}

export async function isAutonomous(id: AutonomyCategoryId): Promise<boolean> {
  const category = (await readCategories()).find((entry) => entry.id === id)
  return category !== undefined && category.level >= AUTONOMY_MAX_LEVEL
}

/** Une validation de l'utilisateur rapproche la catégorie de l'autonomie (« Encore N validations »). */
export async function recordValidation(id: AutonomyCategoryId): Promise<void> {
  const category = (await readCategories()).find((entry) => entry.id === id)
  if (category && category.level < AUTONOMY_MAX_LEVEL) await setLevel(id, category.level + 1)
}
