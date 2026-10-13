import type { ContainerLifecycleEvent } from "@/lib/container-start-history";
import type { ContainerRow } from "@/lib/docker";
import { MODULE_BUILD } from "@/lib/config";
import {
  MAIN_DISK_COLOR,
  MOUNT_COLORS,
  meterColor,
  temperatureColor,
} from "@/lib/host-metrics";
import type { PagePayload } from "@/lib/metrics-cache";
import type { Prefs } from "@/lib/prefs";
import type { Project } from "@/lib/project-model";

const MOCK_HOST = "homelab01";

function container(partial: ContainerRow): ContainerRow {
  return partial;
}

export const MOCK_CONTAINERS: ContainerRow[] = [
  container({
    id: "a1b2c3d4e5f6",
    name: "portainer",
    image: "portainer/portainer-ce:2.27.9",
    status: "Up 14 days (healthy)",
    ports: [9443, 8000],
    stack: "portainer",
    health: "healthy",
    cpuPct: 0.8,
    memPct: 1.2,
  }),
  container({
    id: "b2c3d4e5f6a1",
    name: "grafana",
    image: "grafana/grafana:11.6.0",
    status: "Up 3 days",
    ports: [3001],
    stack: "monitoring",
    health: null,
    cpuPct: 2.4,
    memPct: 3.1,
  }),
  container({
    id: "c3d4e5f6a1b2",
    name: "prometheus",
    image: "prom/prometheus:v3.2.1",
    status: "Up 3 days",
    ports: [9090],
    stack: "monitoring",
    health: null,
    cpuPct: 4.7,
    memPct: 5.8,
  }),
  container({
    id: "d4e5f6a1b2c3",
    name: "node-exporter",
    image: "prom/node-exporter:v1.9.0",
    status: "Up 3 days",
    ports: [9100],
    stack: "monitoring",
    health: null,
    cpuPct: 0.3,
    memPct: 0.2,
  }),
  container({
    id: "e5f6a1b2c3d4",
    name: "jellyfin",
    image: "jellyfin/jellyfin:10.10.6",
    status: "Up 8 days (healthy)",
    ports: [8096],
    stack: "media",
    health: "healthy",
    cpuPct: 12.1,
    memPct: 8.4,
  }),
  container({
    id: "f6a1b2c3d4e5",
    name: "sonarr",
    image: "lscr.io/linuxserver/sonarr:4.0.14",
    status: "Up 8 days",
    ports: [8989],
    stack: "media",
    health: null,
    cpuPct: 1.9,
    memPct: 2.6,
  }),
  container({
    id: "a1c2d3e4f5b6",
    name: "radarr",
    image: "lscr.io/linuxserver/radarr:5.22.4",
    status: "Up 8 days",
    ports: [7878],
    stack: "media",
    health: null,
    cpuPct: 1.4,
    memPct: 2.1,
  }),
  container({
    id: "b1c2d3e4f5a6",
    name: "homelab-app",
    image: "homelab-app:production",
    status: "Up 2 hours (healthy)",
    ports: [10000],
    stack: "homelab-app",
    health: "healthy",
    cpuPct: 6.2,
    memPct: 4.5,
  }),
  container({
    id: "c1d2e3f4a5b6",
    name: "postgres",
    image: "postgres:17-alpine",
    status: "Up 21 days",
    ports: [5432],
    stack: "database",
    health: null,
    cpuPct: 3.8,
    memPct: 11.2,
  }),
  container({
    id: "d1e2f3a4b5c6",
    name: "redis",
    image: "redis:7-alpine",
    status: "Up 21 days",
    ports: [6379],
    stack: "database",
    health: null,
    cpuPct: 0.6,
    memPct: 0.9,
  }),
  container({
    id: "e1f2a3b4c5d6",
    name: "cloudflared",
    image: "cloudflare/cloudflared:2025.4.0",
    status: "Up 5 days",
    ports: [],
    stack: "sem stack",
    health: null,
    cpuPct: 0.4,
    memPct: 0.5,
  }),
  container({
    id: "f1a2b3c4d5e6",
    name: "watchtower",
    image: "containrrr/watchtower:1.7.1",
    status: "Exited (0) 2 hours ago",
    ports: [],
    stack: "sem stack",
    health: null,
    cpuPct: null,
    memPct: null,
  }),
  container({
    id: "a9b8c7d6e5f4",
    name: "uptime-kuma",
    image: "louislam/uptime-kuma:1",
    status: "Up 12 days (healthy)",
    ports: [3002],
    stack: "monitoring",
    health: "healthy",
    cpuPct: 1.1,
    memPct: 1.8,
  }),
];

const MOCK_HISTORY: ContainerLifecycleEvent[] = [
  {
    at: Date.now() - 8 * 60_000,
    name: "homelab-app",
    stack: "homelab-app",
    kind: "restarted",
  },
  {
    at: Date.now() - 42 * 60_000,
    name: "watchtower",
    stack: "sem stack",
    kind: "started",
  },
  {
    at: Date.now() - 3 * 3600_000,
    name: "jellyfin",
    stack: "media",
    kind: "restarted",
  },
  {
    at: Date.now() - 26 * 3600_000,
    name: "postgres",
    stack: "database",
    kind: "started",
  },
];

function buildMockMeters(): Record<string, unknown>[] {
  const cpu = 38;
  const ramPct = 62;
  const ramUsed = 19.8;
  const ramTotal = 32;
  const tempC = 51;
  const storagePct = 58;
  const storageUsed = 412.4;
  const storageTotal = 712;

  const mainDisk = {
    path: "/",
    label: "Raiz (nvme0n1p2)",
    pct: 61,
    used_gb: 380.2,
    total_gb: 620,
    color: MAIN_DISK_COLOR,
  };
  const mounts = [
    {
      path: "/mnt/nas",
      label: "NAS (ZFS)",
      pct: 72,
      used_gb: 28.4,
      total_gb: 39.5,
      color: MOUNT_COLORS[0]!,
    },
    {
      path: "/mnt/backup",
      label: "Backup USB",
      pct: 44,
      used_gb: 3.9,
      total_gb: 8.9,
      color: MOUNT_COLORS[1]!,
    },
  ];

  const tempPct = Math.round(Math.min(100, Math.max(0, tempC)));

  return [
    {
      label: "CPU",
      display: `${cpu}%`,
      sub: "12 cores",
      showSub: true,
      color: meterColor(cpu),
      barWidth: `${cpu}%`,
      showBar: true,
      showChart: true,
      chartKey: "cpu",
      pct: cpu,
      showCaption: false,
      caption: "",
      detailKey: "cpu",
    },
    {
      label: "RAM",
      display: `${ramPct}%`,
      sub: `${ramUsed.toFixed(1)} / ${ramTotal.toFixed(0)} GB`,
      showSub: true,
      color: meterColor(ramPct),
      barWidth: `${ramPct}%`,
      showBar: true,
      showChart: true,
      chartKey: "ram",
      pct: ramPct,
      showCaption: false,
      caption: "",
      detailKey: "ram",
    },
    {
      label: "Temperatura",
      display: `${tempC}°C`,
      sub: "Package · coretemp",
      showSub: true,
      color: temperatureColor(tempC),
      barWidth: `${tempPct}%`,
      showBar: true,
      showChart: true,
      chartKey: "temp",
      pct: tempPct,
      showCaption: false,
      caption: "",
      detailKey: "temp",
    },
    {
      label: "Armazenamento",
      type: "storage",
      display: `${storagePct}%`,
      sub: `${storageUsed.toFixed(1)} / ${storageTotal.toFixed(0)} GB`,
      showSub: true,
      color: meterColor(storagePct),
      barWidth: `${storagePct}%`,
      showBar: false,
      showCaption: false,
      caption: "",
      main: mainDisk,
      mounts,
      detailKey: "storage",
    },
  ];
}

export function getMockPagePayload(host = MOCK_HOST): PagePayload {
  return {
    host,
    build: MODULE_BUILD,
    loaded_build: MODULE_BUILD,
    error: null,
    containers: structuredClone(MOCK_CONTAINERS),
    meters: buildMockMeters(),
    containerHistory: structuredClone(MOCK_HISTORY),
  };
}

export function getInitialMockPrefs(): Prefs {
  return {
    favorites: ["jellyfin", "homelab-app", "grafana"],
    hiddenContainers: [],
    hiddenStacks: [],
    collapsedStacks: [],
    settings: {
      compactView: true,
      truncateNames: true,
      verticalMeters: true,
    },
  };
}

let mockPrefsState: Prefs | null = null;

export function getMockPrefs(): Prefs {
  if (!mockPrefsState) {
    mockPrefsState = getInitialMockPrefs();
  }
  return structuredClone(mockPrefsState);
}

export function applyMockPrefsUpdate(data: Record<string, unknown>): Prefs {
  const current = getMockPrefs();
  const next: Prefs = { ...current };

  if (Array.isArray(data.favorites)) {
    next.favorites = data.favorites.map(String);
  }
  if (Array.isArray(data.hiddenContainers)) {
    next.hiddenContainers = data.hiddenContainers.map(String);
  }
  if (Array.isArray(data.hiddenStacks)) {
    next.hiddenStacks = data.hiddenStacks.map(String);
  }
  if (Array.isArray(data.collapsedStacks)) {
    next.collapsedStacks = data.collapsedStacks.map(String);
  }
  if (data.settings && typeof data.settings === "object") {
    const s = data.settings as Record<string, unknown>;
    next.settings = {
      compactView:
        "compactView" in s ? Boolean(s.compactView) : next.settings.compactView,
      truncateNames:
        "truncateNames" in s
          ? Boolean(s.truncateNames)
          : next.settings.truncateNames,
      verticalMeters:
        "verticalMeters" in s
          ? Boolean(s.verticalMeters)
          : next.settings.verticalMeters,
    };
  }

  mockPrefsState = next;
  return getMockPrefs();
}

export function getMockProjects(): Project[] {
  return [
    {
      id: "proj-homelab",
      name: "Homelab Dashboard",
      accessUrl: "https://homelab01.local:10000",
      environment: "producao",
      containers: ["homelab-app", "postgres", "redis"],
    },
    {
      id: "proj-media",
      name: "Mídia & Streaming",
      accessUrl: "https://jellyfin.homelab.local",
      environment: "producao",
      containers: ["jellyfin", "sonarr", "radarr"],
    },
    {
      id: "proj-obs",
      name: "Observabilidade",
      accessUrl: "https://grafana.homelab.local",
      environment: "homolog",
      containers: ["grafana", "prometheus", "node-exporter", "uptime-kuma"],
    },
    {
      id: "proj-edge",
      name: "Edge & Túneis",
      accessUrl: "",
      environment: "dev",
      containers: ["cloudflared", "portainer"],
    },
  ];
}

function runningMockContainers() {
  return MOCK_CONTAINERS.filter((c) => c.status.startsWith("Up"));
}

export function getMockMeterDetail(kind: string): Record<string, unknown> {
  const running = runningMockContainers();

  if (kind === "cpu") {
    const rows = running
      .map((c) => ({
        name: c.name,
        sub: c.stack,
        value: c.cpuPct ?? 0,
        display: `${(c.cpuPct ?? 0).toFixed(1)}%`,
      }))
      .sort((a, b) => b.value - a.value);
    return { kind, rows, total: 100 };
  }

  if (kind === "ram") {
    const rows = running
      .map((c) => ({
        name: c.name,
        sub: c.stack,
        value: (c.memPct ?? 0) * 1024 ** 3 * 0.01,
        display: `${(c.memPct ?? 0).toFixed(1)}% do host`,
      }))
      .sort((a, b) => b.value - a.value);
    return {
      kind,
      rows,
      total: 32 * 1024 ** 3,
      summary: { sub: "19.8 / 32 GB", display: "62%" },
    };
  }

  if (kind === "temp") {
    return {
      kind,
      rows: [
        { name: "Package", value: 51, display: "51°C" },
        { name: "Core 0", value: 48, display: "48°C" },
        { name: "Core 4", value: 52, display: "52°C" },
        { name: "NVMe", value: 44, display: "44°C" },
      ],
    };
  }

  if (kind === "storage") {
    const sizes = [
      12.4, 8.1, 6.7, 2.2, 45.8, 3.1, 2.9, 1.8, 22.6, 0.4, 0.2, 0.1, 1.5,
    ];
    const rows = MOCK_CONTAINERS.map((c, i) => ({
      name: c.name,
      sub: c.stack,
      value: (sizes[i] ?? 1) * 1024 ** 3,
      display: `${(sizes[i] ?? 1).toFixed(1)} GB`,
    }));
    return { kind, rows, total: 712 * 1024 ** 3 };
  }

  return { kind, error: "Dados mock indisponíveis para este medidor" };
}
