import * as React from "react"
import { Slot } from "radix-ui"

import { cn } from "@/lib/cn"

// g84-retroA(RETRO-1 ○85 T1): `npx shadcn add badge` generated a 6-variant
// emphasis axis (default/secondary/destructive/outline/ghost/link) driven by
// Tailwind utility classes (bg-primary, bg-destructive/10, ...). This app's
// Badge is not an emphasis picker — it is a 5-tone SEMANTIC status chip
// (success/warning/caution/info/neutral, V3-UIX-04 "色は意味のみ") already
// fully implemented by `.civ-badge[data-tone]` in globals.css. Re-deriving
// those 5 tones as a cva()->Tailwind-utility variant map would duplicate,
// not replace, that CSS (and risks drifting from it over time), so this file
// keeps `.civ-badge` as the single color source of truth and only adopts
// shadcn's structural conventions: `cn()`, `data-slot`, and Radix `Slot` for
// optional `asChild` composition (shadcn's own badge.tsx uses the same
// `Slot.Root` pattern at L37 of the pre-edit generated file).
export type BadgeTone = "success" | "warning" | "caution" | "info" | "neutral";
const TONES: readonly BadgeTone[] = ["success", "warning", "caution", "info", "neutral"];

function Badge({
  className,
  tone,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & { tone?: string; asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"
  const t: BadgeTone = TONES.includes(tone as BadgeTone) ? (tone as BadgeTone) : "neutral"

  return (
    <Comp
      data-slot="badge"
      data-tone={t}
      className={cn("civ-badge", className)}
      {...props}
    />
  )
}

export { Badge }
