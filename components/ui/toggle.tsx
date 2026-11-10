"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Toggle as TogglePrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-(--ds-radius-pill) font-(family-name:--ds-font-text) text-(length:--ds-font-caption) font-medium whitespace-nowrap text-(--ds-ink-soft) transition-[background-color,color,border-color,transform] duration-(--ds-dur-hover) ease-(--ds-ease-out) outline-none hover:not-disabled:bg-(--ds-fill-hover) hover:not-disabled:text-(--ds-ink) active:not-disabled:[transform:scale(var(--ds-press-scale))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-(--ds-focus) disabled:cursor-not-allowed disabled:opacity-(--ds-opacity-disabled) aria-invalid:border-(--ds-bad) data-[state=on]:bg-(--ds-fill-selected) data-[state=on]:font-semibold data-[state=on]:text-(--ds-ink) [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline:
          "border border-(--ds-stroke) bg-transparent hover:not-disabled:border-(--ds-stroke-strong) data-[state=on]:border-(--ds-stroke-strong)",
      },
      size: {
        default: "h-(--ds-size-control) min-w-(--ds-size-control) px-2.5",
        sm: "h-(--ds-size-control-sm) min-w-(--ds-size-control-sm) px-2",
        lg: "h-10 min-w-10 px-2.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
