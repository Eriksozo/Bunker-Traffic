import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        /* Notch: .ds-field (fill translúcido, fio que acende no violeta ao focar, coral quando inválido). */
        "h-(--ds-size-control) w-full min-w-0 px-2.5 py-1.5 font-(family-name:--ds-font-text) rounded-(--ds-radius-s) border border-(--ds-stroke) bg-(--ds-fill) text-(length:--ds-font-body) text-(--ds-ink) shadow-none transition-[border-color,background-color] duration-(--ds-dur-hover) ease-(--ds-ease-out) outline-none placeholder:text-(--ds-ink-muted) hover:not-disabled:not-focus:border-(--ds-stroke-strong) disabled:cursor-not-allowed disabled:opacity-(--ds-opacity-disabled) selection:bg-(--ds-accent-selection) selection:text-(--ds-ink) file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-(length:--ds-font-caption) file:font-semibold file:text-(--ds-ink)",
        "focus:border-[color-mix(in_srgb,var(--ds-accent)_80%,transparent)] focus:bg-(--ds-fill-hover) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-solid focus-visible:outline-[color-mix(in_srgb,var(--ds-accent)_45%,transparent)]",
        "aria-invalid:border-(--ds-bad)",
        className
      )}
      {...props}
    />
  )
}

export { Input }
