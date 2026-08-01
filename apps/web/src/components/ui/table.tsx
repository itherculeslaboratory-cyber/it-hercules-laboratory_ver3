import * as React from "react"

import { cn } from "@/lib/cn"

// g84-retroB(RETRO-1 ○85 T-table): `npx shadcn add table` generated a
// Tailwind utility-driven surface (hover:bg-muted/50, [&_tr]:border-b, ...)
// plus a TableFooter/TableCaption pair this app's TableNode never used (no
// footer row, no caption). This app's table is already fully styled by
// .civ-table-scroll/.civ-table (element selectors on thead/tbody/tr/th/td,
// including the <=560px card-reflow rule keyed on data-label — see
// globals.css §2-1), so this file keeps those classes as the single
// spacing/color source of truth, drops the two unused parts (reuse-first —
// no dead exports), and folds the scroll wrapper shadcn's own Table renders
// into the existing .civ-table-scroll div instead of nesting two wrappers.
// Structurally these are plain <table>/<thead>/<tbody>/<tr>/<th>/<td> — no
// Radix primitive exists for "table" (there is nothing to delegate
// keyboard/aria behavior to), so the only thing adopted here is the shared
// component-file convention (data-slot) used by badge/progress/tabs.
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="civ-table-scroll">
      <table data-slot="table" className={cn("civ-table", className)} {...props} />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={className} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={className} {...props} />
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr data-slot="table-row" className={className} {...props} />
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return <th data-slot="table-head" className={className} {...props} />
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td data-slot="table-cell" className={className} {...props} />
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
