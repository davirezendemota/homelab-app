import type { PagePayload } from "@/lib/metrics-cache";

export const DASHBOARD_REFRESH_MS = 5000;

function nowClock() {
  return new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function updateDashboardClock() {
  const el = document.getElementById("clock");
  if (el) el.textContent = nowClock();
}

function cpuPctChanged(a: number | null | undefined, b: number | null | undefined) {
  if (a == null && b == null) return false;
  if (a == null || b == null) return true;
  return Math.round(a * 10) !== Math.round(b * 10);
}

/** Retorna true se o payload de status mudou o suficiente para re-render. */
export function statusPayloadChanged(
  prev: PagePayload,
  next: PagePayload,
): boolean {
  if (prev.error !== next.error) return true;
  if (prev.host !== next.host) return true;
  if (prev.containers.length !== next.containers.length) return true;
  if (prev.meters.length !== next.meters.length) return true;

  for (let i = 0; i < prev.containers.length; i++) {
    const a = prev.containers[i];
    const b = next.containers[i];
    if (
      a.id !== b.id ||
      a.name !== b.name ||
      a.status !== b.status ||
      a.image !== b.image ||
      a.health !== b.health ||
      cpuPctChanged(a.cpuPct, b.cpuPct) ||
      cpuPctChanged(a.memPct, b.memPct) ||
      a.stack !== b.stack ||
      a.ports.length !== b.ports.length ||
      a.ports.some((p, j) => p !== b.ports[j])
    ) {
      return true;
    }
  }

  const prevHistory = prev.containerHistory ?? [];
  const nextHistory = next.containerHistory ?? [];
  if (prevHistory.length !== nextHistory.length) return true;
  for (let i = 0; i < prevHistory.length; i++) {
    const a = prevHistory[i];
    const b = nextHistory[i];
    if (
      a.at !== b.at ||
      a.name !== b.name ||
      a.kind !== b.kind ||
      a.stack !== b.stack
    ) {
      return true;
    }
  }

  for (let i = 0; i < prev.meters.length; i++) {
    const a = prev.meters[i] as Record<string, unknown>;
    const b = next.meters[i] as Record<string, unknown>;
    if (
      a.display !== b.display ||
      a.barWidth !== b.barWidth ||
      a.color !== b.color ||
      a.sub !== b.sub ||
      Math.round(Number(a.pct ?? 0)) !== Math.round(Number(b.pct ?? 0))
    ) {
      return true;
    }
  }

  return false;
}

export async function fetchStatusPayload(): Promise<PagePayload> {
  const res = await fetch("/api/status", { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json() as Promise<PagePayload>;
}
