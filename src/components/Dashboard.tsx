"use client";

import { useCallback, useState } from "react";
import {
  DashboardEmptyShell,
  DashboardErrorContent,
  DashboardHiddenStacksShell,
  DashboardMeters,
  DashboardStacksContent,
} from "@/components/dashboard/DashboardLive";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import {
  DashboardOverlaysBlock,
} from "@/components/dashboard/DashboardStaticBlocks";
import { DashboardToolbar } from "@/components/dashboard/DashboardToolbar";
import {
  DashboardStatusProvider,
  useDashboardStatus,
} from "@/components/dashboard/DashboardStatusProvider";
import { DashboardProjects } from "@/components/dashboard/DashboardProjects";
import { DashboardContainerHistory } from "@/components/dashboard/DashboardContainerHistory";
import { MetersLayoutToggle } from "@/components/dashboard/MetersLayoutToggle";
import {
  emptyPrefsSnapshot,
  prefsSnapshotEqual,
} from "@/lib/dashboard-bridge";
import type { DashboardPrefsSnapshot } from "@/lib/dashboard-view-model";
import type { PagePayload } from "@/lib/metrics-cache";

function DashboardLiveBody({ prefs }: { prefs: DashboardPrefsSnapshot }) {
  const { data, displayError } = useDashboardStatus();
  const verticalMeters = prefs.settings.verticalMeters;

  const projectsPanel = (
    <section
      className="dashboard-panel dashboard-panel--projects"
      aria-label="Projetos"
    >
      <DashboardProjects />
    </section>
  );

  const metersPanel = (
    <section
      className="dashboard-panel dashboard-panel--meters"
      aria-label="Monitor de recursos"
    >
      <div className="dashboard-panel-head dashboard-panel-head--meters">
        <span className="dashboard-panel-eyebrow">Monitor de recursos</span>
        <MetersLayoutToggle verticalMeters={verticalMeters} />
      </div>
      <div className="meters" id="meters">
        <DashboardMeters meters={data.meters} />
      </div>
    </section>
  );

  const metersColumn = (
    <div className="dashboard-meters-stack">
      {metersPanel}
      <DashboardContainerHistory />
    </div>
  );

  const containersPanel = (
    <section
      className="dashboard-panel dashboard-panel--containers"
      aria-label="Containers"
    >
      <div className="dashboard-panel-head dashboard-panel-head--containers">
        <span className="dashboard-panel-eyebrow">Containers</span>
        <DashboardToolbar prefs={prefs} containers={data.containers} />
      </div>
      <DashboardErrorContent error={displayError} />
      <div id="stacks">
        <DashboardStacksContent data={data} prefs={prefs} />
      </div>
      <DashboardHiddenStacksShell data={data} prefs={prefs} />
      <DashboardEmptyShell data={data} prefs={prefs} />
    </section>
  );

  if (!verticalMeters) {
    return (
      <>
        {projectsPanel}
        {metersColumn}
        {containersPanel}
      </>
    );
  }

  return (
    <div className="dashboard-layout">
      <div className="dashboard-main">
        {projectsPanel}
        {containersPanel}
      </div>
      <aside className="dashboard-meters-col">{metersColumn}</aside>
    </div>
  );
}

export function Dashboard({ initialData }: { initialData: PagePayload }) {
  const [prefs, setPrefs] = useState<DashboardPrefsSnapshot>(emptyPrefsSnapshot);

  const onPrefsChange = useCallback((snap: DashboardPrefsSnapshot) => {
    setPrefs((prev) => (prefsSnapshotEqual(prev, snap) ? prev : snap));
  }, []);

  return (
    <>
      <div className="page bg-background">
        <div className="wrap">
          <DashboardHeader prefs={prefs} />
          <DashboardStatusProvider
            initialData={initialData}
            onPrefsChange={onPrefsChange}
          >
            <DashboardLiveBody prefs={prefs} />
          </DashboardStatusProvider>
        </div>
      </div>
      <DashboardOverlaysBlock />
    </>
  );
}
