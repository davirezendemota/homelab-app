import {
  isContainerRunning,
  type ContainerRow,
  validateContainerRef,
  dockerGet,
} from "./docker";

export type ContainerLifecycleKind = "started" | "restarted";

export type ContainerLifecycleEvent = {
  at: number;
  name: string;
  stack: string;
  kind: ContainerLifecycleKind;
};

const HISTORY_MAX = 25;
const DEDUPE_MS = 4000;

const events: ContainerLifecycleEvent[] = [];
const watchByName = new Map<
  string,
  { id: string; startedAt: string | null; running: boolean }
>();

let bootstrapped = false;

export function getContainerStartHistory(): ContainerLifecycleEvent[] {
  return structuredClone(events);
}

function pushEvent(ev: ContainerLifecycleEvent) {
  const last = events[0];
  if (
    last &&
    last.name === ev.name &&
    last.kind === ev.kind &&
    ev.at - last.at < DEDUPE_MS
  ) {
    return;
  }
  events.unshift(ev);
  if (events.length > HISTORY_MAX) events.length = HISTORY_MAX;
}

export function recordContainerLifecycleEvent(
  name: string,
  stack: string,
  kind: ContainerLifecycleKind,
) {
  if (!name) return;
  pushEvent({ at: Date.now(), name, stack, kind });
  const prev = watchByName.get(name);
  watchByName.set(name, {
    id: prev?.id ?? "",
    startedAt: prev?.startedAt ?? null,
    running: true,
  });
}

export function observeContainers(containers: ContainerRow[]) {
  if (!bootstrapped) {
    for (const c of containers) {
      watchByName.set(c.name, {
        id: c.id,
        startedAt: null,
        running: isContainerRunning(c.status),
      });
    }
    bootstrapped = true;
    return;
  }

  for (const c of containers) {
    const running = isContainerRunning(c.status);
    const prev = watchByName.get(c.name);

    if (running) {
      if (!prev || !prev.running) {
        pushEvent({
          at: Date.now(),
          name: c.name,
          stack: c.stack,
          kind: prev ? "restarted" : "started",
        });
      } else if (prev.id !== c.id) {
        pushEvent({
          at: Date.now(),
          name: c.name,
          stack: c.stack,
          kind: "started",
        });
      }
    }

    watchByName.set(c.name, {
      id: c.id,
      startedAt: prev?.startedAt ?? null,
      running,
    });
  }
}

type DockerInspectBrief = {
  Name?: string;
  Id?: string;
  State?: { StartedAt?: string };
  Config?: { Labels?: Record<string, string> };
};

export async function containerIdentityFromRef(
  ref: string,
): Promise<{ name: string; stack: string } | null> {
  try {
    const quoted = validateContainerRef(ref);
    const info = await dockerGet<DockerInspectBrief>(`/containers/${quoted}/json`);
    const name = (info.Name ?? "").replace(/^\//, "");
    if (!name) return null;
    const stack =
      info.Config?.Labels?.["com.docker.compose.project"] ?? "sem stack";
    return { name, stack };
  } catch {
    return null;
  }
}

export async function refreshContainerStartedAt(
  containers: ContainerRow[],
): Promise<void> {
  const running = containers.filter((c) => isContainerRunning(c.status));
  await Promise.all(
    running.map(async (c) => {
      try {
        const quoted = validateContainerRef(c.id);
        const info = await dockerGet<DockerInspectBrief>(
          `/containers/${quoted}/json`,
        );
        const startedAt = info.State?.StartedAt ?? null;
        const id = (info.Id ?? c.id).slice(0, 12);
        const prev = watchByName.get(c.name);

        if (
          prev?.startedAt &&
          startedAt &&
          prev.startedAt !== startedAt &&
          prev.id === id &&
          prev.running
        ) {
          pushEvent({
            at: Date.now(),
            name: c.name,
            stack: c.stack,
            kind: "restarted",
          });
        }

        watchByName.set(c.name, {
          id,
          startedAt,
          running: true,
        });
      } catch {
        /* ignore */
      }
    }),
  );
}

/** Resolve name/stack for API actions when only id/ref is known. */
export async function recordLifecycleFromRef(
  ref: string,
  kind: ContainerLifecycleKind,
): Promise<void> {
  const identity = await containerIdentityFromRef(ref);
  if (identity) {
    recordContainerLifecycleEvent(identity.name, identity.stack, kind);
  }
}
