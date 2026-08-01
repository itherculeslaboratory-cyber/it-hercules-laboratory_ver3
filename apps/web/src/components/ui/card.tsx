import * as React from "react"

import { cn } from "@/lib/cn"

// g84-retroB(RETRO-1 ○85 T-card): `npx shadcn add card` generated a Tailwind
// utility-driven surface (bg-card/ring-foreground/rounded-xl/[--card-spacing])
// plus a 6-part slot system (Header/Title/Description/Action/Content/Footer).
// This app's card contract (icon+title head / meta line / badges row incl. a
// tappable disclosure badge_row child / free children / nav-chevron button,
// V3-AIP-101) does not map onto that slot system — there is no
// Description/Action/Footer equivalent here, and forcing the mapping would
// either leave slots unused (dead code) or contort this app's layout to fit
// shadcn's generic one. So this file adopts only the outer wrapper:
// .civ-card stays the single spacing/color source of truth (no new Tailwind
// utilities), and the tag stays <article> (the pre-retrofit markup was
// <article className="civ-card">, not shadcn's default <div>) so the
// landmark role this app's cards had before the retrofit is unchanged.
function Card({ className, ...props }: React.ComponentProps<"article">) {
  return <article data-slot="card" className={cn("civ-card", className)} {...props} />
}

export { Card }
