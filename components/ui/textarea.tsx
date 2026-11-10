import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full px-2.5 py-2 font-(family-name:--ds-font-text) leading-(--ds-leading-body) rounded-(--ds-radius-s) border border-(--ds-stroke) bg-(--ds-fill) text-(length:--ds-font-body) text-(--ds-ink) shadow-none transition-[border-color,background-color] duration-(--ds-dur-hover) ease-(--ds-ease-out) outline-none placeholder:text-(--ds-ink-muted) hover:not-disabled:not-focus:border-(--ds-stroke-strong) disabled:cursor-not-allowed disabled:opacity-(--ds-opacity-disabled) focus:border-[color-mix(in_srgb,var(--ds-accent)_80%,transparent)] focus:bg-(--ds-fill-hover) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-solid focus-visible:outline-[color-mix(in_srgb,var(--ds-accent)_45%,transparent)] aria-invalid:border-(--ds-bad)",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
