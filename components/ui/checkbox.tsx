"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative size-4 shrink-0 cursor-pointer rounded-(--ds-radius-xs) after:absolute after:-inset-1 border border-(--ds-stroke-strong) bg-(--ds-fill) shadow-none transition-[background-color,border-color] duration-(--ds-dur-quick) ease-(--ds-ease-out) outline-none hover:not-disabled:border-(--ds-ink-faint) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-(--ds-focus) disabled:cursor-not-allowed disabled:opacity-(--ds-opacity-disabled) aria-invalid:border-(--ds-bad) data-[state=checked]:border-(--ds-accent) data-[state=checked]:bg-(--ds-accent) data-[state=checked]:text-(--ds-on-accent) data-[state=indeterminate]:border-(--ds-accent) data-[state=indeterminate]:bg-(--ds-accent) data-[state=indeterminate]:text-(--ds-on-accent)",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="size-3" strokeWidth={3} aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
