"use client"

import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-(--ds-space-s) font-(family-name:--ds-font-text) text-(length:--ds-font-caption) leading-[1.35] font-semibold text-(--ds-ink-soft) select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-(--ds-opacity-disabled) peer-disabled:cursor-not-allowed peer-disabled:opacity-(--ds-opacity-disabled)",
        className
      )}
      {...props}
    />
  )
}

export { Label }
