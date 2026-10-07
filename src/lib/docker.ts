import http from "http";
import { Socket } from "net";
import { DOCKER_SOCKET } from "./config";

const DOCKER_ACTION_TIMEOUT_MS = 120_000;

function unixRequest(
  method: string,
  path: string,
  body?: Buffer,
  timeoutMs = 5000,
): Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    socket.setTimeout(timeoutMs);

    const headers: Record<string, string | number> = {
      Host: "localhost",
      Connection: "close",
    };
    if (body) {
      headers["Content-Length"] = body.length;
    }

    const req = http.request(
      {
        socketPath: DOCKER_SOCKET,
        path,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 500,
            body: Buffer.concat(chunks),
            headers: res.headers,
          });
        });
      },
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout na conexão com Docker"));
    });
    if (body) req.write(body);
    req.end();
  });
}

export async function dockerGet<T = unknown>(path: string): Promise<T> {
  const { status, body } = await unixRequest("GET", path);
  if (status >= 400) {
    throw new Error(`Docker API ${status}: ${body.toString("utf8")}`);
  }
  return JSON.parse(body.toString("utf8")) as T;
}

export async function dockerRequest(
  method: string,
  path: string,
  body?: Buffer,
  timeoutMs = DOCKER_ACTION_TIMEOUT_MS,
): Promise<void> {
  const { status, body: respBody } = await unixRequest(
    method,
    path,
    body,
    timeoutMs,
  );
  if (status >= 400) {
    throw new Error(`Docker API ${status}: ${respBody.toString("utf8")}`);
  }
}

export function dockerOpenStream(
  path: string,
): Promise<{ req: http.ClientRequest; stream: NodeJS.ReadableStream }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: DOCKER_SOCKET,
        path,
        method: "GET",
        headers: { Host: "localhost", Connection: "close" },
      },
      (res) => {
        if ((res.statusCode ?? 500) >= 400) {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c as Buffer));
          res.on("end", () => {
            reject(
              new Error(
                `Docker API ${res.statusCode}: ${Buffer.concat(chunks).toString("utf8")}`,
              ),
            );
          });
          return;
        }
        resolve({ req, stream: res });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const SAFE_CONTAINER_REF = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function validateContainerRef(ref: string): string {
  if (!SAFE_CONTAINER_REF.test(ref)) {
    throw new Error("Referência de container inválida");
  }
  return encodeURIComponent(ref);
}

export function validateStackName(name: string): string {
  if (!name || name.includes("/") || name.includes("\0")) {
    throw new Error("Nome de stack inválido");
  }
  return name;
}

export type ContainerRow = {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: number[];
  stack: string;
  health: string | null;
  cpuPct?: number | null;
  memPct?: number | null;
};

type DockerContainerListItem = {
  Id?: string;
  Names?: string[];
  Image?: string;
  Status?: string;
  Ports?: Array<{ PublicPort?: number; Type?: string }>;
  Labels?: Record<string, string>;
};

export function publishedPorts(
  ports: DockerContainerListItem["Ports"],
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const p of ports ?? []) {
    const pub = p.PublicPort;
    if (!pub || (p.Type ?? "tcp").toLowerCase() !== "tcp") continue;
    if (seen.has(pub)) continue;
    seen.add(pub);
    out.push(pub);
  }
  return out.sort((a, b) => a - b);
}

export function parseHealth(status: string): string | null {
  const s = status.toLowerCase();
  for (const h of ["healthy", "unhealthy", "starting"] as const) {
    if (s.includes(`(${h})`)) return h;
  }
  return null;
}

export function containerName(c: DockerContainerListItem): string {
  const names = (c.Names ?? []).map((n) => n.replace(/^\//, ""));
  const cid = c.Id ?? "";
  return names[0] ?? cid.slice(0, 12);
}

export function containerStack(c: DockerContainerListItem): string {
  return c.Labels?.["com.docker.compose.project"] ?? "sem stack";
}

export function isContainerRunning(status: string): boolean {
  return (status ?? "").toLowerCase().startsWith("up");
}

export async function runningContainers(): Promise<ContainerRow[]> {
  const list = await dockerGet<DockerContainerListItem[]>(
    "/containers/json?all=1",
  );
  const rows: ContainerRow[] = list.map((c) => {
    const status = c.Status ?? "";
    return {
      id: (c.Id ?? "").slice(0, 12),
      name: containerName(c),
      image: c.Image ?? "",
      status,
      ports: publishedPorts(c.Ports),
      stack: containerStack(c),
      health: parseHealth(status),
    };
  });
  rows.sort((a, b) => {
    const sa = a.stack.toLowerCase();
    const sb = b.stack.toLowerCase();
    if (sa !== sb) return sa.localeCompare(sb);
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  return rows;
}

export async function containersInStack(stack: string): Promise<ContainerRow[]> {
  validateStackName(stack);
  return (await runningContainers()).filter((c) => c.stack === stack);
}

async function runParallel<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  maxWorkers = 8,
): Promise<void> {
  if (items.length === 0) return;
  if (items.length === 1) {
    await fn(items[0]!);
    return;
  }
  const workers = Math.min(items.length, maxWorkers);
  let idx = 0;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (idx < items.length) {
        const i = idx++;
        await fn(items[i]!);
      }
    }),
  );
}

export async function containerStart(ref: string): Promise<void> {
  const quoted = validateContainerRef(ref);
  await dockerRequest("POST", `/containers/${quoted}/start`);
}

export async function containerStop(ref: string): Promise<void> {
  const quoted = validateContainerRef(ref);
  await dockerRequest("POST", `/containers/${quoted}/stop?t=30`);
}

export async function containerRestart(ref: string): Promise<void> {
  const quoted = validateContainerRef(ref);
  await dockerRequest("POST", `/containers/${quoted}/restart?t=30`);
}

export async function containerRemove(
  ref: string,
  force = false,
): Promise<void> {
  const quoted = validateContainerRef(ref);
  const suffix = force ? "?force=true" : "";
  await dockerRequest("DELETE", `/containers/${quoted}${suffix}`);
}

export async function stackStop(stack: string): Promise<void> {
  const targets = (await containersInStack(stack)).filter((c) =>
    isContainerRunning(c.status),
  );
  await runParallel(targets, (c) => containerStop(c.id));
}

export async function stackRestart(stack: string): Promise<void> {
  const targets = await containersInStack(stack);
  await runParallel(targets, (c) => containerRestart(c.id));
}

export async function stackRemove(stack: string): Promise<void> {
  const targets = await containersInStack(stack);
  await runParallel(targets, (c) => containerRemove(c.id, true));
}

type ContainerStats = {
  cpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
  };
  memory_stats?: { usage?: number };
};

export function containerCpuPct(stats: ContainerStats): number {
  const cpu = stats.cpu_stats ?? {};
  const precpu = stats.precpu_stats ?? {};
  const cpuUsage = cpu.cpu_usage?.total_usage;
  const preCpuUsage = precpu.cpu_usage?.total_usage;
  const systemUsage = cpu.system_cpu_usage;
  const preSystemUsage = precpu.system_cpu_usage;
  if (
    cpuUsage == null ||
    preCpuUsage == null ||
    systemUsage == null ||
    preSystemUsage == null
  ) {
    return 0;
  }
  const cpuDelta = cpuUsage - preCpuUsage;
  const systemDelta = systemUsage - preSystemUsage;
  if (systemDelta <= 0 || cpuDelta < 0) return 0;
  const online = cpu.online_cpus ?? 1;
  return (cpuDelta / systemDelta) * online * 100;
}

export function containerMemoryBytes(stats: ContainerStats): number {
  const usage = stats.memory_stats?.usage;
  return typeof usage === "number" && usage > 0 ? usage : 0;
}

export async function runningContainerStats(): Promise<
  Array<{ container: DockerContainerListItem; stats: ContainerStats }>
> {
  const containers = await dockerGet<DockerContainerListItem[]>(
    "/containers/json",
  );
  const rows: Array<{
    container: DockerContainerListItem;
    stats: ContainerStats;
  }> = [];

  await runParallel(containers, async (container) => {
    const id = container.Id;
    if (!id) return;
    try {
      const quoted = encodeURIComponent(id);
      const stats = await dockerGet<ContainerStats>(
        `/containers/${quoted}/stats?stream=false`,
      );
      rows.push({ container, stats });
    } catch {
      /* ignore */
    }
  });

  return rows;
}

export function containerMemPctOfHost(
  stats: ContainerStats,
  hostRamTotalBytes: number,
): number {
  if (hostRamTotalBytes <= 0) return 0;
  return (containerMemoryBytes(stats) / hostRamTotalBytes) * 100;
}

export function attachCpuPct(
  containers: ContainerRow[],
  cpuByName: Record<string, number>,
): void {
  for (const c of containers) {
    if (isContainerRunning(c.status)) {
      c.cpuPct = cpuByName[c.name] ?? 0;
    } else {
      c.cpuPct = null;
    }
  }
}

export function attachMemPct(
  containers: ContainerRow[],
  memByName: Record<string, number>,
): void {
  for (const c of containers) {
    if (isContainerRunning(c.status)) {
      c.memPct = memByName[c.name] ?? 0;
    } else {
      c.memPct = null;
    }
  }
}

export async function containerHasTty(ref: string): Promise<boolean> {
  const quoted = validateContainerRef(ref);
  const info = await dockerGet<{ Config?: { Tty?: boolean } }>(
    `/containers/${quoted}/json`,
  );
  return Boolean(info.Config?.Tty);
}

export async function openContainerLogsPath(ref: string): Promise<string> {
  const quoted = validateContainerRef(ref);
  const qs = new URLSearchParams({
    stdout: "1",
    stderr: "1",
    follow: "1",
    tail: String(200),
    timestamps: "0",
  });
  return `/containers/${quoted}/logs?${qs.toString()}`;
}

export { dockerGet as dockerSystemDf };
