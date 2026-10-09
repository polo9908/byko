import { useEffect, useState } from "react"
import type { LinksState } from "@shared/links"

/**
 * État des liens de tickets (pull requests, maquettes, releases), relu à chaque synchronisation terminée côté main.
 * `null` tant que la première lecture n'a pas abouti : l'écran n'affiche alors aucun lien plutôt qu'un lien inventé.
 */
export function useTicketLinks(): { links: LinksState | null; setLinks: (state: LinksState) => void } {
  const [links, setLinks] = useState<LinksState | null>(null)

  useEffect(() => {
    let mounted = true
    const refresh = (): void => {
      window.api.links
        .getState()
        .then((state) => {
          if (mounted) setLinks(state)
        })
        .catch((err: unknown) => console.warn("Lecture des liens de tickets impossible :", err))
    }
    refresh()
    const unsubscribe = window.api.links.onUpdated(refresh)
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  return { links, setLinks }
}
