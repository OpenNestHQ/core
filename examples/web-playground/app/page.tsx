"use client";

import { Header } from "@/components/layout/header";
import { ChatPanel } from "@/components/chat/chat-panel";
import { InteractionPanel } from "@/components/interactions/interaction-panel";
import { TimelinePanel } from "@/components/timeline/timeline-panel";
import { PoliciesPanel } from "@/components/policies/policies-panel";
import { VMEventsPanel } from "@/components/vm-events/vm-events-panel";
import { DSLViewer } from "@/components/dsl-viewer/dsl-viewer";

export default function Home() {
  return (
    <div className="flex h-full flex-col">
      <Header />

      {/* Main grid */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-4 gap-3 p-3">
        {/* Left column: DSL Viewer + Chat */}
        <div className="lg:col-span-2 flex flex-col gap-3 min-h-0">
          {/* DSL Viewer */}
          <div className="h-[120px] shrink-0">
            <DSLViewer />
          </div>

          {/* Chat + Interaction */}
          <div className="flex-1 min-h-0 grid grid-rows-2 gap-3">
            <div className="min-h-0">
              <ChatPanel />
            </div>
            <div className="min-h-0">
              <InteractionPanel />
            </div>
          </div>
        </div>

        {/* Right column: VM Events + Policies + Timeline */}
        <div className="lg:col-span-2 flex flex-col gap-3 min-h-0">
          <div className="flex-1 min-h-0 grid grid-rows-3 gap-3">
            <div className="min-h-0">
              <VMEventsPanel />
            </div>
            <div className="min-h-0">
              <PoliciesPanel />
            </div>
            <div className="min-h-0">
              <TimelinePanel />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
