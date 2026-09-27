interface IconProps {
  size?: number
}

const common = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
}

export function LinkIcon({ size = 14 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} {...common} aria-hidden="true">
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  )
}

export function ClockIcon({ size = 14 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} {...common} aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

export function KeyIcon({ size = 14 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} {...common} aria-hidden="true">
      <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l1.8-1.8a1 1 0 0 0 0-1.4L18.7 4.3a1 1 0 0 0-1.4 0l-1.8 1.8a1 1 0 0 0 0 1.4Z" />
      <path d="m2 22 8-8" />
      <path d="M10.5 13.5 8 11l3-3 2.5 2.5" />
    </svg>
  )
}

export function LockIcon({ size = 14 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} {...common} aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

export function CheckIcon({ size = 26 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#248A3D" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
