import { cn } from "@/lib/utils"

interface TurnStatsRingProps {
  percent: number
  className?: string
}

// Same geometry and colors as the composer's context ring, so the per-turn
// readout is the same indicator rather than a second convention.
export function TurnStatsRing({ percent, className }: TurnStatsRingProps) {
  const clamped = Math.max(0, Math.min(percent, 100))
  const radius = 8
  const circumference = 2 * Math.PI * radius

  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={cn("size-3.5 shrink-0 -rotate-90", className)}
    >
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        strokeWidth="2"
        className="stroke-muted-foreground/30"
      />
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference - (clamped / 100) * circumference}
        className="stroke-muted-foreground"
      />
    </svg>
  )
}
