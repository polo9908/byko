import { DIGEST_KINDS_BY_ROLE, DIGEST_MAX_ITEMS, DIGEST_MAX_PER_KIND, DIGEST_STALE_DAYS } from "../shared/digest"
import type { DailyDigest, DigestItem, DigestKind } from "../shared/digest"
import type { ProfileRole } from "../shared/profile"
import type { TrackedTicket } from "../shared/links"
import type { JiraAttentionIssue } from "./integrations/jira"

/**
 * Digest de la vue journée (contrat : docs/ipc/digest.md). Fonction pure : le handler IPC lit les sources, celle-ci
 * choisit et ordonne. Chaque ligne décrit un fait constaté dans une source ; rien n'est déduit par l'IA.
 */

export interface DigestSources {
  issues: JiraAttentionIssue[]
  /** Nombre de décisions de réunion à consigner. */
  proposals: number
  tracked: TrackedTicket[]
}

const DAY_MS = 24 * 60 * 60 * 1000
const plural = (count: number): string => (count > 1 ? "s" : "")

export function buildDigest(role: ProfileRole | undefined, sources: DigestSources, now = Date.now()): DailyDigest {
  const byKind: Record<DigestKind, DigestItem[]> = {
    blocker: [],
    blocked: [],
    stale: [],
    proposal: [],
    transition: [],
    "design-ready": [],
  }

  for (const issue of [...sources.issues].sort((a, b) => b.blocks.length - a.blocks.length)) {
    if (issue.blocks.length === 0) continue
    byKind.blocker.push({
      id: `blocker:${issue.key}:${issue.blocks.length}`,
      kind: "blocker",
      text: `${issue.key} bloque ${issue.blocks.length} ticket${plural(issue.blocks.length)}`,
      detail: issue.summary,
      url: issue.url,
    })
  }
  for (const issue of sources.issues) {
    if (issue.blockedBy.length === 0) continue
    byKind.blocked.push({
      id: `blocked:${issue.key}`,
      kind: "blocked",
      text: `${issue.key} attend ${issue.blockedBy.join(", ")}`,
      detail: issue.summary,
      url: issue.url,
    })
  }
  const stale = sources.issues
    .filter((issue) => issue.inProgress && issue.updatedAt !== undefined)
    .map((issue) => ({ issue, days: Math.floor((now - Date.parse(issue.updatedAt as string)) / DAY_MS) }))
    .filter(({ days }) => days >= DIGEST_STALE_DAYS)
    .sort((a, b) => b.days - a.days)
  for (const { issue, days } of stale) {
    byKind.stale.push({
      // Sans le nombre de jours : le point reste « le même » d'un jour à l'autre, il n'est notifié qu'une fois.
      id: `stale:${issue.key}`,
      kind: "stale",
      text: `${issue.key} sans activité depuis ${days} jours`,
      detail: issue.summary,
      url: issue.url,
    })
  }
  if (sources.proposals > 0) {
    byKind.proposal.push({
      id: "proposal",
      kind: "proposal",
      text: `${sources.proposals} décision${plural(sources.proposals)} de réunion à consigner`,
      target: "memory",
    })
  }
  const pending = sources.tracked.filter((ticket) => ticket.pendingTransition)
  if (pending.length > 0) {
    byKind.transition.push({
      id: "transition",
      kind: "transition",
      text:
        pending.length === 1
          ? `${pending[0].issueKey} à passer à « ${pending[0].pendingTransition} »`
          : `${pending.length} tickets à passer à « terminé »`,
      detail: pending.length === 1 ? pending[0].summary : "Leurs pull requests sont fusionnées",
      target: "journal",
    })
  }
  for (const ticket of sources.tracked) {
    for (const design of ticket.designs) {
      if (design.status !== "ready_for_dev" || !design.url.startsWith("https://")) continue
      byKind["design-ready"].push({
        id: `design-ready:${design.fileKey}:${design.nodeId}`,
        kind: "design-ready",
        text: `Maquette prête pour le développement : ${design.name}`,
        detail: ticket.issueKey,
        url: design.url,
      })
    }
  }

  const items = DIGEST_KINDS_BY_ROLE[role ?? "default"]
    .flatMap((kind) => byKind[kind].slice(0, DIGEST_MAX_PER_KIND))
    .slice(0, DIGEST_MAX_ITEMS)
  return { ...(role ? { role } : {}), items }
}
