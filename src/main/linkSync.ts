import { requireActiveAccount } from "./accountPaths"
import * as autonomy from "./autonomy"
import * as journal from "./journal"
import * as jira from "./integrations/jira"
import * as figma from "./integrations/figma"
import { githubForge } from "./integrations/github"
import type { Forge, ForgePullRequest } from "./integrations/forge"
import * as ticketLinks from "./ticketLinks"
import { designGlobalId, pullRequestGlobalId } from "./ticketLinks"
import type { StoredTicket } from "./ticketLinks"
import { mentionsIssueKey } from "../shared/links"
import type { LinkEvent, LinkedRelease, LinksState } from "../shared/links"

/**
 * Moteur de liaison automatique (contrat : docs/ipc/ticket-links.md). À chaque passage, pour les tickets créés en
 * réunion : repère les pull requests (clé Jira dans la branche, le titre ou la description) et les maquettes Figma
 * (clé dans le nom d'une page, section ou d'un cadre), pose les liens sur le ticket, puis signale sur le ticket une
 * fusion, une maquette validée (« Ready for dev ») ou une release. Le passage du ticket à « terminé » suit le niveau
 * d'autonomie « Statut des tickets » : proposé tant que la catégorie n'est pas autonome.
 *
 * Chaque action n'est faite qu'une fois (`posted`, écrit sur disque action par action). Un lien est idempotent côté
 * Jira ; un commentaire ne l'est pas et suit un marquage en deux temps (voir `comment`) : jamais posté deux fois, et
 * signalé s'il a pu être perdu.
 * BYKO n'a pas de serveur : pas de webhook, la détection se fait par relève périodique tant que l'app est ouverte.
 */

const FORGES: Forge[] = [githubForge]
/** Au-delà, un ticket n'est plus suivi : la relève ne grossit pas indéfiniment. */
const TRACK_DAYS = 120
/** Une PR fusionnée depuis plus longtemps n'est plus cherchée dans les releases. */
const RELEASE_LOOKUP_DAYS = 60
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_ERRORS = 5
/** Un ticket que Jira dit introuvable n'est retiré du suivi qu'après ce délai (droit retiré, autre site Jira…). */
const MISSING_GRACE_DAYS = 7
/** Durée pendant laquelle un commentaire resté « en cours » est signalé dans les erreurs de synchronisation. */
const PENDING_NOTICE_DAYS = 7
const AUTONOMY_CATEGORY = "statut-tickets"

interface SyncContext {
  events: LinkEvent[]
  errors: Set<string>
  /** Tickets qui n'existent plus dans Jira : retirés du suivi en fin de passage. */
  gone: Set<string>
}

function note(context: SyncContext, error: unknown): void {
  context.errors.add(error instanceof Error ? error.message.slice(0, 200) : "Erreur inconnue.")
}

function sameRepo(a: { forge: string; repo: string }, forge: string, repo: string): boolean {
  return a.forge === forge && a.repo.toLowerCase() === repo.toLowerCase()
}

/** Un appel Jira vient d'échouer pour ce ticket : introuvable (signalé en fin de passage) ou erreur à afficher. */
async function failed(ticket: StoredTicket, context: SyncContext, error: unknown): Promise<void> {
  const progress = await jira.fetchIssueProgress(ticket.issueKey).catch(() => null)
  if (progress === undefined) context.gone.add(ticket.issueKey)
  else note(context, error)
}

/** L'action est faite sur Jira ; si le journal ne peut pas être écrit, on le dit sans la refaire. */
async function logged(context: SyncContext, entry: Promise<unknown>): Promise<void> {
  await entry.catch(() => context.errors.add("Journal non mis à jour : une action faite sur Jira n'y figure pas."))
}

/**
 * Lien distant : l'appel est idempotent (`globalId`), il est donc fait d'abord et inscrit ensuite. S'il ne peut pas
 * être inscrit, il sera simplement reposé à l'identique au passage suivant, sans nouvelle entrée de journal.
 */
async function link(
  ticket: StoredTicket,
  context: SyncContext,
  target: { globalId: string; url: string; title: string; journalTitle: string },
): Promise<void> {
  const marker = `link:${target.globalId}`
  if (ticket.posted.includes(marker) || context.gone.has(ticket.issueKey)) return
  let created: { id: string }
  try {
    created = await jira.upsertRemoteLink(ticket.issueKey, target)
  } catch (error) {
    await failed(ticket, context, error)
    return
  }
  try {
    // Faux : ticket retiré du suivi pendant le passage (la réunion est revenue dessus).
    if (!(await ticketLinks.mark(ticket.issueKey, marker))) return
  } catch (error) {
    note(context, error)
    return
  }
  ticket.posted.push(marker)
  context.events.push({ issueKey: ticket.issueKey, kind: "linked", text: target.journalTitle })
  await logged(
    context,
    journal.addEntry(target.journalTitle, "auto", {
      undo: { type: "jira-remote-link", issueKey: ticket.issueKey, linkId: created.id, globalId: target.globalId },
      url: ticket.url,
    }),
  )
}

/**
 * Commentaire : pas idempotent, donc jamais posté deux fois. Il est inscrit « en cours » sur disque avant l'envoi,
 * puis « fait ». Un refus net de Jira le désinscrit (retenté au passage suivant). S'il reste « en cours » — app
 * quittée pendant l'envoi, délai dépassé alors que Jira l'a peut-être reçu — il n'est pas renvoyé : il est signalé.
 */
async function comment(
  ticket: StoredTicket,
  context: SyncContext,
  marker: string,
  body: string,
  event: Pick<LinkEvent, "kind" | "text">,
): Promise<void> {
  const key = ticket.issueKey
  if (ticket.posted.includes(marker) || context.gone.has(key)) return
  const since = ticket.pending[marker]
  if (since) {
    if (Date.now() - Date.parse(since) < PENDING_NOTICE_DAYS * DAY_MS) {
      context.errors.add(`${key} : un commentaire (« ${event.text} ») a été interrompu et n'a peut-être pas été posté. Vérifiez le ticket.`)
    }
    return
  }
  try {
    if (!(await ticketLinks.begin(key, marker))) return
  } catch (error) {
    note(context, error)
    return
  }
  ticket.pending[marker] = new Date().toISOString()
  let created: { id: string }
  try {
    created = await jira.createComment(key, body)
  } catch (error) {
    // Délai dépassé : Jira a pu traiter la demande, le commentaire reste « en cours » et sera signalé.
    if (error instanceof Error && error.name === "TimeoutError") return
    try {
      await ticketLinks.abort(key, marker)
      delete ticket.pending[marker]
    } catch (abortError) {
      note(context, abortError)
    }
    await failed(ticket, context, error)
    return
  }
  try {
    await ticketLinks.complete(key, marker)
  } catch (error) {
    // Posté mais resté « en cours » sur disque : signalé aux passages suivants, jamais renvoyé.
    note(context, error)
  }
  delete ticket.pending[marker]
  ticket.posted.push(marker)
  context.events.push({ issueKey: key, ...event })
  await logged(
    context,
    journal.addEntry(event.text, "auto", {
      undo: { type: "jira-comment", issueKey: key, commentId: created.id },
      url: ticket.url,
    }),
  )
}

/** Liens et commentaires dus pour l'état courant du ticket. */
async function applyLinks(ticket: StoredTicket, context: SyncContext): Promise<void> {
  const key = ticket.issueKey
  for (const pullRequest of ticket.pullRequests) {
    const globalId = pullRequestGlobalId(pullRequest)
    const label = `PR #${pullRequest.number}`
    await link(ticket, context, {
      globalId,
      url: pullRequest.url,
      title: `Pull request #${pullRequest.number} — ${pullRequest.title}`,
      journalTitle: `${label} (${pullRequest.repo}) liée à ${key}`,
    })
    if (pullRequest.state === "merged") {
      await comment(
        ticket,
        context,
        `merged:${globalId}`,
        `Pull request #${pullRequest.number} fusionnée : ${pullRequest.title}\n${pullRequest.url}`,
        { kind: "merged", text: `${key} : ${label} fusionnée` },
      )
    }
    const release = pullRequest.release
    if (release) {
      const releaseId = `byko:release:${pullRequest.forge}:${pullRequest.repo}@${release.name}`
      await link(ticket, context, {
        globalId: releaseId,
        url: release.url,
        title: `Release ${release.name}`,
        journalTitle: `Release ${release.name} liée à ${key}`,
      })
      await comment(
        ticket,
        context,
        `released:${globalId}`,
        `Livré dans la release ${release.name} (${label}).\n${release.url}`,
        { kind: "released", text: `${key} : livré dans ${release.name}` },
      )
    }
  }
  for (const design of ticket.designs) {
    const globalId = designGlobalId(design)
    await link(ticket, context, {
      globalId,
      url: design.url,
      title: `Maquette Figma — ${design.name}`,
      journalTitle: `Maquette « ${design.name} » liée à ${key}`,
    })
    if (design.status !== "in_progress") {
      await comment(
        ticket,
        context,
        `ready:${globalId}`,
        `Maquette « ${design.name} » validée (prête pour le développement).\n${design.url}`,
        { kind: "design-ready", text: `${key} : maquette « ${design.name} » validée` },
      )
    }
  }
}

/** Toutes les PR liées sont fusionnées : le ticket passe à « terminé », seul si la catégorie est autonome, sinon sur validation. */
async function applyTransition(ticket: StoredTicket, context: SyncContext): Promise<void> {
  const live = ticket.pullRequests.filter((pullRequest) => pullRequest.state !== "closed")
  if (ticket.transition || context.gone.has(ticket.issueKey)) return
  if (live.length === 0 || live.some((pullRequest) => pullRequest.state !== "merged")) return
  try {
    const progress = await jira.fetchIssueProgress(ticket.issueKey)
    if (!progress) {
      context.gone.add(ticket.issueKey)
      return
    }
    if (progress.done) {
      ticket.transition = "done"
      return
    }
    const target = await jira.findDoneTransition(ticket.issueKey)
    if (!target) {
      // Le flux du projet ne permet pas de terminer le ticket depuis son statut actuel : rien à proposer.
      ticket.transition = "declined"
      return
    }
    if (await autonomy.isAutonomous(AUTONOMY_CATEGORY)) {
      await jira.transitionIssue(ticket.issueKey, target.id)
      ticket.transition = "done"
      const text = `${ticket.issueKey} passé à « ${target.statusName} » (pull requests fusionnées)`
      context.events.push({ issueKey: ticket.issueKey, kind: "transitioned", text })
      await logged(context, journal.addEntry(text, "auto", { url: ticket.url }))
      return
    }
    ticket.transition = "proposed"
    ticket.transitionTarget = target.statusName
    context.events.push({
      issueKey: ticket.issueKey,
      kind: "transition-proposed",
      text: `${ticket.issueKey} : passer à « ${target.statusName} » ? À valider dans le Journal.`,
    })
  } catch (error) {
    note(context, error)
  }
}

async function runSync(): Promise<LinkEvent[]> {
  const snapshot = await ticketLinks.read()
  const context: SyncContext = { events: [], errors: new Set(), gone: new Set() }
  const cutoff = Date.now() - TRACK_DAYS * DAY_MS
  const tickets = snapshot.tickets.filter((ticket) => Date.parse(ticket.createdAt) >= cutoff)

  const finish = async (updated: Map<string, StoredTicket>): Promise<LinkEvent[]> => {
    await ticketLinks.update((store) => {
      const now = Date.now()
      store.tickets = store.tickets
        .filter((ticket) => Date.parse(ticket.createdAt) >= cutoff)
        .flatMap((ticket): StoredTicket[] => {
          const next = updated.get(ticket.issueKey)
          if (!next) return [ticket]
          // Introuvable dans Jira : signalé, et retiré du suivi seulement si cela dure (jamais sur un seul 404).
          // Un passage où Jira ne le dit plus introuvable remet le compteur à zéro : 7 jours d'affilée, pas cumulés.
          let missingSince: string | undefined
          if (context.gone.has(ticket.issueKey)) {
            missingSince = next.missingSince ?? new Date(now).toISOString()
            if (now - Date.parse(missingSince) > MISSING_GRACE_DAYS * DAY_MS) return []
            context.errors.add(`${ticket.issueKey} est introuvable dans Jira (supprimé ou inaccessible) : rien n'a été mis à jour.`)
          }
          // Ce qui a été écrit dans le fichier pendant le passage fait foi : lien annulé, action inscrite, réponse de
          // l'utilisateur à une proposition de changement de statut.
          const dismissed = [...new Set([...ticket.dismissed, ...next.dismissed])]
          const answered = ticket.transition === "done" || ticket.transition === "declined"
          return [{
            ...next,
            summary: ticket.summary,
            posted: ticket.posted,
            pending: ticket.pending,
            transition: answered ? ticket.transition : next.transition,
            transitionTarget: answered ? undefined : next.transitionTarget,
            missingSince,
            dismissed,
            pullRequests: next.pullRequests.filter((pullRequest) => !dismissed.includes(pullRequestGlobalId(pullRequest))),
            designs: next.designs.filter((design) => !dismissed.includes(designGlobalId(design))),
          }]
        })
      store.lastSyncAt = new Date().toISOString()
      store.errors = [...context.errors].slice(0, MAX_ERRORS)
    })
    return context.events
  }

  if (tickets.length === 0) return finish(new Map())
  if (!(await jira.getStatus()).connected) {
    context.errors.add("Jira n'est pas connecté : les tickets ne peuvent pas être mis à jour.")
    return finish(new Map())
  }

  // Une seule lecture par dépôt et par fichier, quel que soit le nombre de tickets.
  const pullsByRepo: { forge: Forge; repo: string; pulls: ForgePullRequest[] }[] = []
  for (const forge of FORGES) {
    const repos = snapshot.repos.filter((repo) => repo.forge === forge.id)
    if (repos.length === 0 || !(await forge.isConnected())) continue
    for (const repo of repos) {
      try {
        pullsByRepo.push({ forge, repo: repo.name, pulls: await forge.listPullRequests(repo.name) })
      } catch (error) {
        note(context, error)
      }
    }
  }
  const nodesByFile = new Map<string, figma.FigmaNamedNode[]>()
  if (snapshot.figmaFiles.length > 0 && (await figma.getStatus()).connected) {
    for (const file of snapshot.figmaFiles) {
      try {
        nodesByFile.set(file.key, await figma.listNamedNodes(file.key))
      } catch (error) {
        note(context, error)
      }
    }
  }

  // Une même PR peut porter plusieurs tickets : sa release n'est cherchée qu'une fois par passage.
  const releaseLookups = new Map<string, Promise<LinkedRelease | undefined>>()
  const lookupRelease = (forge: Forge, repo: string, pull: ForgePullRequest): Promise<LinkedRelease | undefined> => {
    const lookupKey = `${forge.id}:${repo}#${pull.number}`
    let lookup = releaseLookups.get(lookupKey)
    if (!lookup) {
      lookup = forge.findRelease(repo, pull).catch((error: unknown) => {
        note(context, error)
        return undefined
      })
      releaseLookups.set(lookupKey, lookup)
    }
    return lookup
  }

  const updated = new Map<string, StoredTicket>()
  for (const ticket of tickets) {
    const next: StoredTicket = structuredClone(ticket)
    const key = next.issueKey

    // Une source qui n'a pas répondu garde ses liens connus ; une source qui n'est plus suivie perd les siens.
    next.pullRequests = next.pullRequests.filter((pullRequest) =>
      snapshot.repos.some((repo) => sameRepo(pullRequest, repo.forge, repo.name)),
    )
    for (const { forge, repo, pulls } of pullsByRepo) {
      for (const pull of pulls) {
        if (!mentionsIssueKey(`${pull.branch}\n${pull.title}\n${pull.body}`, key)) continue
        const identity = { forge: forge.id, repo, number: pull.number }
        if (next.dismissed.includes(pullRequestGlobalId(identity))) continue
        const known = next.pullRequests.find(
          (pullRequest) => sameRepo(pullRequest, forge.id, repo) && pullRequest.number === pull.number,
        )
        let release = known?.release
        const recentlyMerged =
          pull.state === "merged" && pull.mergedAt && Date.now() - Date.parse(pull.mergedAt) < RELEASE_LOOKUP_DAYS * DAY_MS
        if (!release && recentlyMerged) release = await lookupRelease(forge, repo, pull)
        const linked = { ...identity, title: pull.title.slice(0, 200), url: pull.url, state: pull.state, release }
        next.pullRequests = [
          ...next.pullRequests.filter((pullRequest) => pullRequest !== known),
          linked,
        ].sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number)
      }
    }

    next.designs = next.designs.filter(
      (design) => snapshot.figmaFiles.some((file) => file.key === design.fileKey) && !nodesByFile.has(design.fileKey),
    )
    for (const [fileKey, nodes] of nodesByFile) {
      for (const node of nodes) {
        if (!mentionsIssueKey(node.name, key)) continue
        if (next.dismissed.includes(designGlobalId({ fileKey, nodeId: node.id }))) continue
        next.designs.push({ fileKey, nodeId: node.id, name: node.name.slice(0, 120), url: node.url, status: node.status })
      }
    }

    await applyLinks(next, context)
    await applyTransition(next, context)
    updated.set(key, next)
  }
  return finish(updated)
}

/** Un seul passage à la fois par compte : un second appel pendant un passage en reçoit le résultat. */
const running = new Map<string, Promise<LinkEvent[]>>()

export function syncNow(): Promise<LinkEvent[]> {
  const accountId = requireActiveAccount()
  const current = running.get(accountId)
  if (current) return current
  const run = runSync().finally(() => running.delete(accountId))
  running.set(accountId, run)
  return run
}

/**
 * Réponse de l'utilisateur à « passer le ticket à terminé ? ». Accepter fait la transition et rapproche la catégorie
 * de l'autonomie ; refuser clôt la proposition, qui ne reviendra pas.
 */
export async function resolveTransition(issueKey: string, accept: boolean): Promise<LinksState> {
  const store = await ticketLinks.read()
  const ticket = store.tickets.find((known) => known.issueKey === issueKey)
  if (!ticket || ticket.transition !== "proposed") {
    throw new Error("Aucun changement de statut en attente pour ce ticket.")
  }
  let statusName: string | undefined
  if (accept) {
    const target = await jira.findDoneTransition(issueKey)
    if (target) {
      await jira.transitionIssue(issueKey, target.id)
      statusName = target.statusName
    } else if (!(await jira.fetchIssueProgress(issueKey))?.done) {
      // Déjà terminé (à la main, ou par une validation précédente) : la proposition est simplement close.
      throw new Error(`Le flux Jira ne permet plus de terminer "${issueKey}" depuis son statut actuel.`)
    }
  }
  // La réponse est enregistrée dès que Jira est à jour ; journal et autonomie ne peuvent plus la faire échouer.
  await ticketLinks.update((current) => {
    const known = current.tickets.find((entry) => entry.issueKey === issueKey)
    if (!known) return
    known.transition = accept ? "done" : "declined"
    known.transitionTarget = undefined
  })
  if (statusName) {
    // Message fixe : celui de l'erreur peut citer un extrait du fichier (JSON.parse).
    const warn = (): void => console.warn("[links] validation faite sur Jira, journal ou autonomie non mis à jour.")
    await journal.addEntry(`${issueKey} passé à « ${statusName} »`, "with_user", { url: ticket.url }).catch(warn)
    await autonomy.recordValidation(AUTONOMY_CATEGORY).catch(warn)
  }
  return ticketLinks.getState()
}
