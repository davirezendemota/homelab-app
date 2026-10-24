export type ContainerRow = {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: number[];
  stack: string;
  stackKind?: "" | "compose" | "swarm";
  health: string | null;
  cpuPct?: number | null;
  memPct?: number | null;
};

export type StorageMount = {
  path: string;
  label: string;
  pct: number;
  used_gb: number;
  total_gb: number;
  color: string;
};

export type AgentSession = {
  id: string;
  parent: string;
  kind: "claude" | "cursor";
  label: string;
  pid: number;
  cwd: string;
  startedAt: number;
  uptime: string;
  procs: number;
  cpuPct: number;
  cpuDisplay: string;
  memBytes: number;
  memDisplay: string;
  color: string;
};

export type Meter = Record<string, unknown> & {
  label: string;
  display: string;
  color: string;
  detailKey?: string;
  chartKey?: string;
  pct?: number;
};

export type LifecycleEvent = {
  at: number;
  name: string;
  stack: string;
  kind: "started" | "restarted";
};

export type PagePayload = {
  host: string;
  build: string;
  loaded_build: string;
  error: string | null;
  containers: ContainerRow[];
  meters: Meter[];
  containerHistory: LifecycleEvent[];
};

export type Settings = {
  compactView: boolean;
  truncateNames: boolean;
  verticalMeters: boolean;
  containerColumnWidths?: number[];
};

export type Prefs = {
  favorites: string[];
  hiddenContainers: string[];
  hiddenStacks: string[];
  collapsedStacks: string[];
  settings: Settings;
};

export type ProjectEnvironment = "dev" | "homolog" | "producao";

export type Project = {
  id: string;
  name: string;
  accessUrl: string;
  environment: ProjectEnvironment;
  containers: string[];
};

export type BootPayload = {
  data: PagePayload;
  prefs: Prefs;
  projects: Project[];
};
