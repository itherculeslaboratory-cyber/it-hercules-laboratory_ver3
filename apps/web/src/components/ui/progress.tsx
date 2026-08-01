"use client"

import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

// g84-retroA(RETRO-1 ○85 T1): `npx shadcn add progress` generated a Root+
// Indicator pair styled with Tailwind utilities (bg-muted track, bg-primary
// fill, h-1 rounded-full). This app already has a complete, tested visual
// for progress (.civ-progress/.civ-progress-track/.civ-progress-fill in
// globals.css) so the classNames below were swapped to those — visuals are
// unchanged. What genuinely came from Radix: role="progressbar" and
// aria-valuenow/-valuemin/-valuemax are now set by ProgressPrimitive.Root
// itself instead of being hand-maintained (the old ProgressBar in
// renderer.tsx set all three manually).
function Progress({
  className,
  value,
  max,
  label,
  ...props
}: Omit<React.ComponentProps<typeof ProgressPrimitive.Root>, "value" | "max"> & {
  value: number
  max: number
  label?: string
}) {
  const safeMax = max > 0 ? max : 100
  const clamped = Math.min(safeMax, Math.max(0, value))
  const pct = safeMax > 0 ? (clamped / safeMax) * 100 : 0
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={className ?? "civ-progress"}
      value={clamped}
      max={safeMax}
      aria-label={label || undefined}
      {...props}
    >
      <div className="civ-progress-track">
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className="civ-progress-fill"
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      </div>
    </ProgressPrimitive.Root>
  )
}

export { Progress }
