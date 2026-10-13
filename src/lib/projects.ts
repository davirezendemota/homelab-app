import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { DB_PATH } from "./config";
import { getMockProjects } from "./mock-dashboard-data";
import { isMockMode } from "./mock-mode";
import {
  parseProjectEnvironment,
  type Project,
  type ProjectEnvironment,
} from "./project-model";

export type { Project, ProjectEnvironment } from "./project-model";
export {
  PROJECT_ENVIRONMENTS,
  environmentLabel,
  parseProjectEnvironment,
} from "./project-model";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    access_url TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS project_containers (
    project_id TEXT NOT NULL,
    container_name TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (project_id, container_name),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
`;

let db: Database.Database | null = null;

function migrateProjects(conn: Database.Database): void {
  const cols = conn.prepare("PRAGMA table_info(projects)").all() as Array<{
    name: string;
  }>;
  if (!cols.some((c) => c.name === "access_url")) {
    conn.exec(
      "ALTER TABLE projects ADD COLUMN access_url TEXT NOT NULL DEFAULT ''",
    );
  }
  if (!cols.some((c) => c.name === "environment")) {
    conn.exec(
      "ALTER TABLE projects ADD COLUMN environment TEXT NOT NULL DEFAULT 'dev'",
    );
  }
}

function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (dir) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.exec(SCHEMA);
    migrateProjects(db);
  }
  return db;
}

export function normalizeAccessUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Link deve usar http ou https");
    }
    return url.href;
  } catch (e) {
    if (e instanceof Error && e.message === "Link deve usar http ou https") {
      throw e;
    }
    throw new Error("Link de acesso inválido");
  }
}

function readProjects(conn: Database.Database): Project[] {
  const projectRows = conn
    .prepare(
      "SELECT id, name, access_url, environment FROM projects ORDER BY position ASC, name ASC",
    )
    .all() as Array<{
      id: string;
      name: string;
      access_url: string;
      environment: string;
    }>;

  const containerStmt = conn.prepare(
    "SELECT container_name FROM project_containers WHERE project_id = ? ORDER BY position ASC, container_name ASC",
  );

  return projectRows.map((row) => ({
    id: row.id,
    name: row.name,
    accessUrl: row.access_url ?? "",
    environment: parseProjectEnvironment(row.environment),
    containers: containerStmt
      .all(row.id)
      .map((c) => String((c as { container_name: string }).container_name)),
  }));
}

export function listProjects(): Project[] {
  if (isMockMode()) {
    return getMockProjects();
  }
  return readProjects(getDb());
}

export function createProject(
  name: string,
  accessUrl = "",
  environment: ProjectEnvironment = "dev",
): Project {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Nome do projeto é obrigatório");
  }
  const link = normalizeAccessUrl(accessUrl);
  const env = parseProjectEnvironment(environment);
  const conn = getDb();
  const maxPos =
    (
      conn
        .prepare("SELECT COALESCE(MAX(position), -1) AS m FROM projects")
        .get() as { m: number }
    ).m + 1;
  const id = randomUUID();
  conn
    .prepare(
      "INSERT INTO projects (id, name, position, access_url, environment) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, trimmed, maxPos, link, env);
  return {
    id,
    name: trimmed,
    accessUrl: link,
    environment: env,
    containers: [],
  };
}

function setProjectContainers(
  conn: Database.Database,
  projectId: string,
  containers: string[],
) {
  conn.prepare("DELETE FROM project_containers WHERE project_id = ?").run(projectId);
  const stmt = conn.prepare(
    "INSERT INTO project_containers (project_id, container_name, position) VALUES (?, ?, ?)",
  );
  containers.forEach((raw, position) => {
    const name = String(raw).trim();
    if (name) stmt.run(projectId, name, position);
  });
}

export function updateProject(
  id: string,
  patch: {
    name?: string;
    accessUrl?: string;
    environment?: ProjectEnvironment;
    containers?: string[];
  },
): Project {
  const conn = getDb();
  const existing = conn
    .prepare("SELECT id, name FROM projects WHERE id = ?")
    .get(id) as { id: string; name: string } | undefined;
  if (!existing) {
    throw new Error("Projeto não encontrado");
  }

  const tx = conn.transaction(() => {
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (!trimmed) throw new Error("Nome do projeto é obrigatório");
      conn.prepare("UPDATE projects SET name = ? WHERE id = ?").run(trimmed, id);
    }
    if (patch.accessUrl !== undefined) {
      const link = normalizeAccessUrl(patch.accessUrl);
      conn
        .prepare("UPDATE projects SET access_url = ? WHERE id = ?")
        .run(link, id);
    }
    if (patch.environment !== undefined) {
      const env = parseProjectEnvironment(patch.environment);
      conn
        .prepare("UPDATE projects SET environment = ? WHERE id = ?")
        .run(env, id);
    }
    if (patch.containers !== undefined) {
      const seen = new Set<string>();
      const unique: string[] = [];
      for (const raw of patch.containers) {
        const name = String(raw).trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        unique.push(name);
      }
      setProjectContainers(conn, id, unique);
    }
  });
  tx();

  const updated = readProjects(conn).find((p) => p.id === id);
  if (!updated) throw new Error("Projeto não encontrado");
  return updated;
}

export function deleteProject(id: string): void {
  const conn = getDb();
  const result = conn.prepare("DELETE FROM projects WHERE id = ?").run(id);
  if (result.changes === 0) {
    throw new Error("Projeto não encontrado");
  }
}

export function reorderProjects(orderedIds: string[]): Project[] {
  const conn = getDb();
  const existing = readProjects(conn);
  if (orderedIds.length !== existing.length) {
    throw new Error("Lista de ordem incompleta");
  }
  const known = new Set(existing.map((p) => p.id));
  for (const id of orderedIds) {
    if (!known.has(id)) {
      throw new Error("Projeto inválido na ordem");
    }
  }
  const tx = conn.transaction(() => {
    const stmt = conn.prepare("UPDATE projects SET position = ? WHERE id = ?");
    orderedIds.forEach((id, position) => stmt.run(position, id));
  });
  tx();
  return readProjects(conn);
}

export function initProjectsDb(): void {
  getDb();
}
