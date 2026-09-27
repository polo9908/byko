import { useEffect, useRef, useState } from "react"
import WelcomeStep from "./screens/onboarding/WelcomeStep"
import ConnectJiraStep from "./screens/onboarding/ConnectJiraStep"
import ChooseAiStep from "./screens/onboarding/ChooseAiStep"
import ConnectFigmaStep from "./screens/onboarding/ConnectFigmaStep"
import ConnectCalendarStep from "./screens/onboarding/ConnectCalendarStep"
import SummaryStep from "./screens/onboarding/SummaryStep"
import ReadyStep from "./screens/onboarding/ReadyStep"
import SettingsModal from "./screens/settings/SettingsModal"
import JournalView from "./screens/journal/JournalView"
import DayView from "./screens/dayview/DayView"
import PointDEquipeView from "./screens/dayview/PointDEquipeView"
import { playSetupSound, playSfx } from "./lib/sound"
import type { CalendarEventSummary } from "@shared/googleCalendar"

type Stage = "email" | "jira" | "ai" | "figma" | "calendar" | "summary" | "ready" | "day" | "journal" | "pointdequipe"

function App(): React.JSX.Element {
  const [stage, setStage] = useState<Stage>("email")
  const [email, setEmail] = useState("")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventSummary[] | null>(null)
  // Une réunion ne doit basculer vers l'écran d'enregistrement qu'une fois : sans ce suivi, revenir
  // manuellement à la vue journée (bouton Retour) pendant qu'elle est encore en cours y renverrait aussitôt.
  const autoOpenedMeetingIds = useRef<Set<string>>(new Set())

  // Sound design du prototype (voir `lib/sound.ts`). `step` sonne à chaque étape franchie de
  // l'assistant — avant ET arrière, comme le `go()` de `Setup.dc.html` — et sur rien d'autre.
  function goTo(next: Stage): void {
    playSetupSound("step")
    setStage(next)
  }

  // Côté application, le prototype sonne `listen` à l'ouverture du Journal et `tick` à celle des Réglages.
  function openJournal(): void {
    playSfx("listen")
    setStage("journal")
  }

  function openSettings(): void {
    playSfx("tick")
    setSettingsOpen(true)
  }

  useEffect(() => {
    function refreshCalendar(): void {
      window.api.calendar.listTodayEvents().then(setCalendarEvents).catch(() => setCalendarEvents(null))
    }
    refreshCalendar()
    const timer = setInterval(refreshCalendar, 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (stage !== "day" || settingsOpen || !calendarEvents) return
    const now = new Date()
    const activeMeeting = calendarEvents.find(
      (event) => !event.allDay && new Date(event.start) <= now && now <= new Date(event.end),
    )
    if (activeMeeting && !autoOpenedMeetingIds.current.has(activeMeeting.id)) {
      autoOpenedMeetingIds.current.add(activeMeeting.id)
      setStage("pointdequipe")
    }
  }, [calendarEvents, stage, settingsOpen])

  let screen: React.JSX.Element
  if (stage === "email") {
    screen = (
      <WelcomeStep
        onContinue={(value) => {
          setEmail(value)
          goTo("jira")
        }}
      />
    )
  } else if (stage === "jira") {
    screen = <ConnectJiraStep email={email} onBack={() => goTo("email")} onContinue={() => goTo("ai")} />
  } else if (stage === "ai") {
    screen = <ChooseAiStep onBack={() => goTo("jira")} onContinue={() => goTo("figma")} />
  } else if (stage === "figma") {
    screen = (
      <ConnectFigmaStep
        onBack={() => goTo("ai")}
        onContinue={() => goTo("calendar")}
        onSkip={() => goTo("calendar")}
      />
    )
  } else if (stage === "calendar") {
    screen = (
      <ConnectCalendarStep
        onBack={() => goTo("figma")}
        onContinue={() => goTo("summary")}
        onSkip={() => goTo("summary")}
      />
    )
  } else if (stage === "summary") {
    screen = <SummaryStep onBack={() => goTo("calendar")} onFinish={() => goTo("ready")} />
  } else if (stage === "ready") {
    // Le prototype ne sonne plus rien sur « Commencer ma journée » : le `done` de l'écran de
    // lancement a déjà retenti (voir ReadyStep).
    screen = <ReadyStep onStart={() => setStage("day")} />
  } else if (stage === "journal") {
    screen = <JournalView onBack={() => setStage("day")} />
  } else if (stage === "pointdequipe") {
    screen = <PointDEquipeView onBack={() => setStage("day")} />
  } else {
    screen = (
      <>
        <DayView
          calendarEvents={calendarEvents}
          onOpenJournal={openJournal}
          onOpenSettings={openSettings}
          onOpenPointDEquipe={() => setStage("pointdequipe")}
        />
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      </>
    )
  }

  // DayView a son propre bouton Journal, intégré dans son en-tête. Point d'équipe n'a pas
  // d'en-tête : ce bouton flottant lui sert de seul accès permanent au Journal.
  const showJournalButton = stage === "pointdequipe"

  return (
    <>
      {screen}
      {showJournalButton && (
        <button type="button" className="global-journal-button" onClick={openJournal}>
          Journal
        </button>
      )}
    </>
  )
}

export default App
