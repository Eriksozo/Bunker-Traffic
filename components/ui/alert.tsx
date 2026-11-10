import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/* Notch banner (ver .ds-banner em app/notch-ds.css): o estado vem no glifo (ⓘ info, ⛔ erro) e na cor
   do fio; o texto fica em ink para continuar legível. Um <svg> como primeiro filho substitui o glifo. */
const alertVariants = cva(
  "relative grid w-full grid-cols-[var(--ds-size-icon)_1fr] items-start gap-x-(--ds-space-s) gap-y-0.5 rounded-(--ds-radius-m) border border-[color-mix(in_srgb,var(--_tone)_22%,transparent)] bg-[color-mix(in_srgb,var(--_tone)_10%,transparent)] px-(--ds-space-m) py-2.5 font-(family-name:--ds-font-text) text-(length:--ds-font-body) leading-(--ds-leading-body) text-(--ds-ink) before:col-start-1 before:row-start-1 before:mt-[calc((1.5em_-_var(--ds-size-icon))/2)] before:size-(--ds-size-icon) before:bg-(--_tone) before:content-[''] before:[-webkit-mask:var(--_glyph)_center/contain_no-repeat] before:[mask:var(--_glyph)_center/contain_no-repeat] has-[>svg]:before:hidden [&>svg]:mt-[calc((1.5em_-_var(--ds-size-icon))/2)] [&>svg]:size-(--ds-size-icon) [&>svg]:text-(--_tone)",
  {
    variants: {
      variant: {
        default: "[--_glyph:var(--ds-glyph-info)] [--_tone:var(--ds-neutral)]",
        destructive: "[--_glyph:var(--ds-glyph-bad)] [--_tone:var(--ds-bad)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "col-start-2 min-h-4 font-semibold text-(--ds-ink)",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-2 grid justify-items-start gap-(--ds-space-xs) text-(length:--ds-font-body) text-(--ds-ink-soft) [&_p]:leading-(--ds-leading-body)",
        className
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }
