import { Cpu } from "lucide-react";

export function Header() {
  return (
    <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card shrink-0">
      <div className="flex items-center gap-3">
        <Cpu className="h-5 w-5 text-accent" />
        <div>
          <h1 className="text-sm font-semibold text-foreground">
            OpenNest Playground
          </h1>
          <p className="text-[10px] text-muted-foreground">
            VM Execution Viewer
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>HomeDSL → Parser → VM → Devices</span>
      </div>
    </header>
  );
}
