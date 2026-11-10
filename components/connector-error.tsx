import { LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { connectorErrorRecovery } from "@/lib/connector-errors.mjs";

/** Render in the affected feature, leaving the rest of the Site usable.
 *  Notch banner: glifo ⛔ e fio coral marcam o erro; o texto fica legível em ink e a única ação é a recuperação. */
export function ConnectorError({
  error,
  connectorName,
  reconnectHref,
}: {
  error: { status: string; message: string };
  connectorName: string;
  reconnectHref: string;
}) {
  const recovery = connectorErrorRecovery(error, connectorName, reconnectHref);
  return (
    <div
      role="alert"
      className="ds-banner ds-banner--bad flex-wrap"
    >
      <div className="ds-banner__body basis-[min(100%,16rem)]">
        <p className="break-words">{recovery.message}</p>
      </div>
      {recovery.action && (
        <div className="ds-banner__actions max-w-full">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-auto min-h-(--ds-size-control-sm) max-w-full py-1 whitespace-normal text-left"
          >
            <a href={recovery.action.href} target="_top">
              <LinkIcon aria-hidden="true" />
              <span className="min-w-0 break-words">{recovery.action.label}</span>
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
