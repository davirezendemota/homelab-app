import type { ContainerRow } from "@/lib/docker";
import { SHADCN } from "@/lib/shadcn-theme";

export type DashboardViewState = {
  query: string;
  sortKey: "name" | "port" | "status" | null;
  sortDir: 1 | -1;
  showHidden: boolean;
};

export type DashboardPrefsSnapshot = {
  favorites: string[];
  hiddenContainers: string[];
  hiddenStacks: string[];
  collapsedStacks: string[];
  settings: {
    compactView: boolean;
    truncateNames: boolean;
    verticalMeters: boolean;
  };
  view: DashboardViewState;
};

export type DecoratedContainer = ContainerRow & {
  dotColor: string;
  dotGlow: string;
  statusColor: string;
  statusBg: string;
  noPorts: boolean;
};

export type StackBlock = {
  name: string;
  count: number;
  containers: DecoratedContainer[];
  showTitle: boolean;
  isFavorites: boolean;
};

export function uptimeSeconds(status: string): number {
  const m = status.match(/up\s+(\d+)\s+(second|minute|hour|day|week|month)/i);
  if (!m) return 0;
  const mult: Record<string, number> = {
    second: 1,
    minute: 60,
    hour: 3600,
    day: 86400,
    week: 604800,
    month: 2592000,
  };
  return parseInt(m[1], 10) * (mult[m[2].toLowerCase()] ?? 1);
}

export function dotStyle(status: string) {
  const s = status.toLowerCase();
  if (!s.startsWith("up")) {
    return { dot: SHADCN.mutedForeground, glow: SHADCN.mutedForegroundGlow };
  }
  if (s.includes("second") || s.includes("minute")) {
    return { dot: "#d29922", glow: "rgba(210,153,34,.18)" };
  }
  return { dot: "#3fb950", glow: "rgba(63,185,80,.18)" };
}

export function healthStyle(health: string | null) {
  if (health === "healthy") {
    return { color: "#56d364", bg: "rgba(63,185,80,.10)" };
  }
  if (health === "starting") {
    return { color: "#e3b341", bg: "rgba(210,153,34,.12)" };
  }
  if (health === "unhealthy") {
    return { color: "#f85149", bg: "rgba(248,81,73,.12)" };
  }
  return { color: SHADCN.mutedForeground, bg: SHADCN.mutedForegroundBg };
}

export function cpuBarColor(pct: number | null | undefined, running: boolean) {
  if (!running || pct == null) return SHADCN.mutedForeground;
  if (pct <= 0) return SHADCN.mutedForeground;
  if (pct <= 50) return SHADCN.foreground;
  if (pct <= 85) return "#e3b341";
  return "#f85149";
}

export function usageMetricBadgeStyle(
  pct: number | null | undefined,
  running: boolean,
): { color: string; bg: string } {
  if (!running || pct == null || pct <= 0) {
    return { color: SHADCN.mutedForeground, bg: SHADCN.mutedForegroundBg };
  }
  if (pct <= 50) {
    return {
      color: SHADCN.foreground,
      bg: "color-mix(in oklch, var(--foreground) 10%, transparent)",
    };
  }
  if (pct <= 85) {
    return { color: "#e3b341", bg: "rgba(210,153,34,.12)" };
  }
  return { color: "#f85149", bg: "rgba(248,81,73,.12)" };
}

export function formatPct(value: number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "0%";
  for (const decimals of [1, 2, 3, 4]) {
    const factor = 10 ** decimals;
    if (Math.round(n * factor) / factor > 0) {
      return n.toFixed(decimals) + "%";
    }
  }
  return n.toFixed(4) + "%";
}

export function decorate(c: ContainerRow): DecoratedContainer {
  const dot = dotStyle(c.status);
  const health = healthStyle(c.health);
  return {
    ...c,
    dotColor: dot.dot,
    dotGlow: dot.glow,
    statusColor: health.color,
    statusBg: health.bg,
    noPorts: !c.ports || c.ports.length === 0,
  };
}

export function isContainerRunning(status: string) {
  return (status || "").toLowerCase().startsWith("up");
}

function isFavorite(favorites: Set<string>, name: string) {
  return favorites.has(name);
}

function isHiddenStack(hiddenStacks: Set<string>, stackName: string) {
  return hiddenStacks.has(stackName);
}

function isHiddenContainer(
  c: ContainerRow,
  hiddenStacks: Set<string>,
  hiddenContainers: Set<string>,
) {
  return hiddenStacks.has(c.stack) || hiddenContainers.has(c.name);
}

function isEmptyStack(name: string) {
  return name === "sem stack";
}

function compareRows(
  a: ContainerRow,
  b: ContainerRow,
  sortKey: DashboardViewState["sortKey"],
  sortDir: number,
) {
  if (!sortKey) return a.name.localeCompare(b.name);
  let r = 0;
  if (sortKey === "name") r = a.name.localeCompare(b.name);
  else if (sortKey === "port")
    r = (a.ports[0] ?? Infinity) - (b.ports[0] ?? Infinity);
  else if (sortKey === "status")
    r = uptimeSeconds(a.status) - uptimeSeconds(b.status);
  return r * sortDir;
}

function compareStacks(
  a: string,
  b: string,
  sortKey: DashboardViewState["sortKey"],
  sortDir: number,
  map: Record<string, ContainerRow[]>,
) {
  const aEmpty = isEmptyStack(a);
  const bEmpty = isEmptyStack(b);
  if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
  if (sortKey) {
    const ca = map[a];
    const cb = map[b];
    if (ca.length && cb.length) {
      const r = compareRows(ca[0], cb[0], sortKey, sortDir);
      if (r !== 0) return r;
    }
  }
  return a.localeCompare(b);
}

function groupRowsIntoStacks(
  rows: ContainerRow[],
  prefs: DashboardPrefsSnapshot,
): StackBlock[] {
  const favorites = new Set(prefs.favorites);
  const { sortKey, sortDir } = prefs.view;
  const favByName = new Map<string, ContainerRow>();
  const restRows: ContainerRow[] = [];
  rows.forEach((c) => {
    if (isFavorite(favorites, c.name)) favByName.set(c.name, c);
    else restRows.push(c);
  });
  const favRows = [...favorites]
    .map((name) => favByName.get(name))
    .filter(Boolean) as ContainerRow[];

  const order: string[] = [];
  const map: Record<string, ContainerRow[]> = {};
  restRows.forEach((c) => {
    if (!map[c.stack]) {
      map[c.stack] = [];
      order.push(c.stack);
    }
    map[c.stack].push(c);
  });
  for (const name of order) {
    map[name].sort((a, b) => compareRows(a, b, sortKey, sortDir));
  }
  order.sort((a, b) => compareStacks(a, b, sortKey, sortDir, map));

  const stacks = order.map((name) => ({
    name,
    count: map[name].length,
    containers: map[name].map(decorate),
    showTitle: !isEmptyStack(name),
    isFavorites: false,
  }));

  if (favRows.length) {
    stacks.unshift({
      name: "Favoritos",
      count: favRows.length,
      containers: favRows.map(decorate),
      showTitle: true,
      isFavorites: true,
    });
  }

  return stacks;
}

function sortRows(rows: ContainerRow[], view: DashboardViewState) {
  const { sortKey, sortDir } = view;
  return [...rows].sort((a, b) => compareRows(a, b, sortKey, sortDir));
}

export function isFlatView(view: DashboardViewState) {
  return Boolean(view.sortKey);
}

export function filteredRows(containers: ContainerRow[], query: string) {
  const q = query.trim().toLowerCase();
  return containers.filter(
    (c) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.image.toLowerCase().includes(q) ||
      c.stack.toLowerCase().includes(q),
  );
}

export type ContainerLists = {
  flat: boolean;
  flatRows?: ContainerRow[];
  visibleStacks?: StackBlock[];
  hiddenStacks?: StackBlock[];
  hiddenCount: number;
};

export function buildLists(
  containers: ContainerRow[],
  prefs: DashboardPrefsSnapshot,
): ContainerLists {
  const hiddenStacks = new Set(prefs.hiddenStacks);
  const hiddenContainers = new Set(prefs.hiddenContainers);
  const rows = filteredRows(containers, prefs.view.query);
  const visibleRows = rows.filter(
    (c) => !isHiddenContainer(c, hiddenStacks, hiddenContainers),
  );
  const hiddenRows = rows.filter((c) =>
    isHiddenContainer(c, hiddenStacks, hiddenContainers),
  );

  if (isFlatView(prefs.view)) {
    const flatSource = prefs.view.showHidden ? rows : visibleRows;
    return {
      flat: true,
      flatRows: sortRows(flatSource, prefs.view),
      hiddenCount: hiddenRows.length,
    };
  }
  return {
    flat: false,
    visibleStacks: groupRowsIntoStacks(visibleRows, prefs),
    hiddenStacks: groupRowsIntoStacks(hiddenRows, {
      ...prefs,
      favorites: [],
    }),
    hiddenCount: hiddenRows.length,
  };
}

export function stackKey(stack: StackBlock) {
  return stack.isFavorites ? "__favorites__" : stack.name;
}

export function isStackCollapsed(
  stack: StackBlock,
  collapsedStacks: Set<string>,
) {
  return collapsedStacks.has(stackKey(stack));
}

export function isHiddenByName(
  name: string,
  containers: ContainerRow[],
  prefs: DashboardPrefsSnapshot,
) {
  const hiddenStacks = new Set(prefs.hiddenStacks);
  const hiddenContainers = new Set(prefs.hiddenContainers);
  const container = containers.find((c) => c.name === name);
  return container
    ? isHiddenContainer(container, hiddenStacks, hiddenContainers)
    : hiddenContainers.has(name);
}

export function portHref(host: string, port: number) {
  const scheme = [443, 8443, 9443].includes(port) ? "https" : "http";
  return `${scheme}://${host}:${port}`;
}
