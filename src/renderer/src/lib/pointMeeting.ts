import type { CalendarEventSummary } from "@shared/googleCalendar"

/** Insensible à la casse/accents : couvre "Point d'équipe", "point d'équipe hebdo", etc. */
export function isPointDEquipe(label: string): boolean {
  return label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .includes("point d'equipe")
}

/**
 * L'invitation à laquelle se rattache l'enregistrement : la réunion en cours, sinon le « point d'équipe »
 * du jour (le plus proche de maintenant). Sans agenda connecté, `undefined` : l'écran fonctionne sans.
 */
export function pickPointMeeting(
  events: CalendarEventSummary[] | null,
  now: Date = new Date(),
): CalendarEventSummary | undefined {
  const timed = (events ?? []).filter((event) => !event.allDay)
  const active = timed.find((event) => new Date(event.start) <= now && now <= new Date(event.end))
  if (active) return active
  const distance = (event: CalendarEventSummary): number => Math.abs(new Date(event.start).getTime() - now.getTime())
  return timed.filter((event) => isPointDEquipe(event.title)).sort((a, b) => distance(a) - distance(b))[0]
}
