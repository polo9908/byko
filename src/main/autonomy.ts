import { app } from "electron"
import { mkdir, readFile, writeFile } from "fs/promises"
import { dirname, join } from "path"
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
]

function autonomyFilePath(): string {
  return join(app.getPath("userData"), "autonomy.json")
}

async function readCategories(): Promise<AutonomyCategory[]> {
  try {
    const raw = await readFile(autonomyFilePath(), "utf-8")
    return JSON.parse(raw) as AutonomyCategory[]
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
  return readCategories()
}

export async function setLevel(id: AutonomyCategoryId, level: number): Promise<AutonomyCategory[]> {
  const clamped = Math.max(0, Math.min(AUTONOMY_MAX_LEVEL, Math.round(level)))
  const categories = await readCategories()
  const next = categories.map((category) => (category.id === id ? { ...category, level: clamped } : category))
  await writeCategories(next)
  return next
}
