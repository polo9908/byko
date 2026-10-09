import type { ForgeId, LinkedRelease, PullRequestState } from "../../shared/links"

/**
 * Interface commune aux forges (GitHub aujourd'hui, GitLab ensuite) : le moteur de liaison (`linkSync.ts`) ne connaît
 * qu'elle. Une forge ne renvoie que des URL de son propre domaine, en https.
 */
export interface ForgePullRequest {
  number: number
  title: string
  /** Nom de la branche source. */
  branch: string
  body: string
  url: string
  state: PullRequestState
  /** ISO 8601, si fusionnée. */
  mergedAt?: string
  mergeCommitSha?: string
}

export interface Forge {
  id: ForgeId
  label: string
  isConnected(): Promise<boolean>
  /** Les pull requests les plus récemment mises à jour du dépôt (ouvertes, fusionnées et fermées). */
  listPullRequests(repo: string): Promise<ForgePullRequest[]>
  /** Première release publiée contenant le commit de fusion ; `undefined` si pas encore livrée. */
  findRelease(repo: string, pullRequest: ForgePullRequest): Promise<LinkedRelease | undefined>
}
