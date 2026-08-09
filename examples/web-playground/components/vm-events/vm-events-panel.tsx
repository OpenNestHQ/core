"use client";

import { useVM } from "@/hooks/use-vm";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity } from "lucide-react";
import type { VMEvent } from "@opennest/vm";

const EVENT_COLORS: Record<string, string> = {
  "program:begin": "text-blue-400",
  "program:end": "text-blue-400",
  "statement:begin": "text-purple-400",
  "statement:end": "text-purple-400",
  "handler:begin": "text-yellow-400",
  "handler:end": "text-yellow-400",
  "middleware:begin": "text-orange-400",
  "middleware:end": "text-orange-400",
  "action:begin": "text-green-400",
  "action:end": "text-green-400",
};

function formatEvent(event: VMEvent): string {
  switch (event.kind) {
    case "program:begin":
      return "▶ Program started";
    case "program:end":
      return `■ Program ${event.status}${event.errorCount ? ` (${event.errorCount} errors)` : ""}`;
    case "statement:begin":
      return `▶ Statement [${event.index}] (${event.statementKind})`;
    case "statement:end":
      return `■ Statement ${event.status}${event.resolvedDeviceCount ? ` (${event.resolvedDeviceCount} devices)` : ""}`;
    case "handler:begin":
      return `▶ Handler: ${event.name}`;
    case "handler:end":
      return `■ Handler ${event.status}`;
    case "middleware:begin":
      return `▶ Middleware: ${event.name} · ${event.actionKind} on ${event.deviceId}`;
    case "middleware:end":
      return `■ Middleware ${event.status}: ${event.decision}${event.reason ? ` · ${event.reason}` : ""}`;
    case "action:begin":
      return `▶ Action: ${event.actionKind} on ${event.deviceName}${event.property ? `.${event.property}` : ""}`;
    case "action:end":
      return `■ Action ${event.status}${event.error ? ` · ${event.error}` : ""}`;
    default:
      return `Unknown event`;
  }
}

export function VMEventsPanel() {
  const { state } = useVM();

  return (
    <Card className="flex h-full flex-col border-border">
      <CardHeader className="flex flex-row items-center justify-between py-2 px-3">
        <CardTitle className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          VM Events
        </CardTitle>
        <Badge variant="default">{state.events.length}</Badge>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full">
          {state.events.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground p-4">
              Aucun événement
            </div>
          ) : (
            <div className="flex flex-col font-mono">
              {state.events.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-2 px-3 py-1 border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors text-[11px]"
                >
                  <span className="text-muted-foreground shrink-0 w-8">
                    #{entry.id}
                  </span>
                  <span
                    className={`${EVENT_COLORS[entry.event.kind] ?? "text-muted-foreground"} truncate`}
                  >
                    {formatEvent(entry.event)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
