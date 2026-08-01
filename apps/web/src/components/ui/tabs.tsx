"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/cn"

// g84-retroB(RETRO-1 ○85 T-tabs): `npx shadcn add tabs` generated a Tailwind
// utility-driven variant (line/default TabsList, focus-ring/shadow states via
// bg-muted/data-active:bg-background/...). This app's tabs are a single
// visual style already fully implemented by .civ-tab-list/.civ-tab/
// .civ-tab-panel in globals.css (V3-UIX-81 civ-interactive states), so this
// file keeps those classes as the single color/spacing source of truth and
// only adopts shadcn's structural convention (data-slot) plus the underlying
// Radix Tabs primitive for keyboard arrow-navigation + roving tabindex +
// role=tablist/tab/tabpanel wiring (previously hand-rolled with plain
// <button role="tab">). Signature (TabsNode's own tabs[]/tab_id contract) is
// unchanged — this file only supplies the primitive wrappers.
function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("civ-tabs", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("civ-tab-list", className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  active,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & { active?: boolean }) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      data-active={active || undefined}
      className={cn("civ-interactive", "civ-tab", className)}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("civ-tab-panel", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
