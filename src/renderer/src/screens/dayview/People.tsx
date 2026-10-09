import { colorOf, findMentions } from "@renderer/lib/people"
import "./people.css"

interface PersonTextProps {
  text: string
  people: string[]
}

/** Un texte dont les prénoms des présents sont surlignés, chacun dans sa couleur. */
export function PersonText({ text, people }: PersonTextProps): React.JSX.Element {
  const mentions = findMentions(text, people)
  if (mentions.length === 0) return <>{text}</>
  const parts: React.ReactNode[] = []
  let cursor = 0
  for (const mention of mentions) {
    if (mention.start > cursor) parts.push(text.slice(cursor, mention.start))
    parts.push(
      <mark key={mention.start} className={`person-mark person-mark--${colorOf(mention.person)}`}>
        {text.slice(mention.start, mention.end)}
      </mark>,
    )
    cursor = mention.end
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

/** Les présents, en pastilles colorées : la même couleur que leurs mentions dans le compte rendu. */
export function PeopleChips({ people }: { people: string[] }): React.JSX.Element | null {
  if (people.length === 0) return null
  return (
    <ul className="people-chips" aria-label="Présents">
      {people.map((name, index) => (
        <li key={name} className={`person-mark person-mark--${colorOf(index)}`}>
          {name}
        </li>
      ))}
    </ul>
  )
}
