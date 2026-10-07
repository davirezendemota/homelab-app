"use client";

import { useDashboardStatus } from "@/components/dashboard/DashboardStatusProvider";
import type { ContainerLifecycleEvent } from "@/lib/container-start-history";

function kindLabel(kind: ContainerLifecycleEvent["kind"]) {
  return kind === "restarted" ? "Reiniciado" : "Ligado";
}

function formatTime(at: number) {
  return new Date(at).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function stackLabel(stack: string) {
  return stack === "sem stack" ? "Sem stack" : stack;
}

export function DashboardContainerHistory() {
  const { data } = useDashboardStatus();
  const items = data.containerHistory ?? [];

  return (
    <section
      className="dashboard-panel dashboard-panel--container-history"
      aria-label="Histórico de containers"
    >
      <div className="dashboard-panel-head dashboard-panel-head--container-history">
        <span className="dashboard-panel-eyebrow">Histórico de containers</span>
      </div>
      {items.length === 0 ? (
        <p className="container-history-empty">
          Nenhum container ligado ou reiniciado recentemente.
        </p>
      ) : (
        <ul className="container-history-list">
          {items.map((ev) => (
            <li key={`${ev.at}-${ev.name}-${ev.kind}`} className="container-history-item">
              <span
                className={`container-history-kind container-history-kind--${ev.kind}`}
              >
                {kindLabel(ev.kind)}
              </span>
              <span className="container-history-name" title={ev.name}>
                {ev.name}
              </span>
              <span className="container-history-meta">
                <span className="container-history-stack">{stackLabel(ev.stack)}</span>
                <time className="container-history-time" dateTime={new Date(ev.at).toISOString()}>
                  {formatTime(ev.at)}
                </time>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
