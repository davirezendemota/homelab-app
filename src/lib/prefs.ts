import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { DB_PATH, DEFAULT_SETTINGS } from "./config";
import { applyMockPrefsUpdate, getMockPrefs } from "./mock-dashboard-data";
import { isMockMode } from "./mock-mode";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS favorites (
    position INTEGER NOT NULL,
    name TEXT NOT NULL PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS hidden_containers (
    name TEXT NOT NULL PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS hidden_stacks (
    name TEXT NOT NULL PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS collapsed_stacks (
    stack_key TEXT NOT NULL PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT NOT NULL PRIMARY KEY,
    value TEXT NOT NULL
);
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

export type Settings = {
  compactView: boolean;
  truncateNames: boolean;
  verticalMeters: boolean;
};

export type Prefs = {
  favorites: string[];
  hiddenContainers: string[];
  hiddenStacks: string[];
  collapsedStacks: string[];
  settings: Settings;
};

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (dir) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.exec(SCHEMA);
  }
  return db;
}

function readPrefs(conn: Database.Database): Prefs {
  const favorites = conn
    .prepare("SELECT name FROM favorites ORDER BY position ASC")
    .all()
    .map((row) => String((row as { name: string }).name));
  const hiddenContainers = conn
    .prepare("SELECT name FROM hidden_containers ORDER BY name")
    .all()
    .map((row) => String((row as { name: string }).name));
  const hiddenStacks = conn
    .prepare("SELECT name FROM hidden_stacks ORDER BY name")
    .all()
    .map((row) => String((row as { name: string }).name));
  const collapsedStacks = conn
    .prepare("SELECT stack_key FROM collapsed_stacks ORDER BY stack_key")
    .all()
    .map((row) => String((row as { stack_key: string }).stack_key));

  const settings: Settings = {
    compactView: DEFAULT_SETTINGS.compactView,
    truncateNames: DEFAULT_SETTINGS.truncateNames,
    verticalMeters: DEFAULT_SETTINGS.verticalMeters,
  };
  const rows = conn.prepare("SELECT key, value FROM settings").all() as Array<{
    key: string;
    value: string;
  }>;
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) {
      settings[row.key as keyof Settings] = row.value === "true";
    }
  }

  return {
    favorites,
    hiddenContainers,
    hiddenStacks,
    collapsedStacks,
    settings,
  };
}

export function getPrefs(): Prefs {
  if (isMockMode()) {
    return getMockPrefs();
  }
  return readPrefs(getDb());
}

export function updatePrefs(data: Record<string, unknown>): Prefs {
  if (isMockMode()) {
    return applyMockPrefsUpdate(data);
  }
  const conn = getDb();
  const tx = conn.transaction(() => {
    if ("favorites" in data && Array.isArray(data.favorites)) {
      conn.prepare("DELETE FROM favorites").run();
      const stmt = conn.prepare(
        "INSERT INTO favorites (position, name) VALUES (?, ?)",
      );
      (data.favorites as unknown[]).forEach((name, position) => {
        stmt.run(position, String(name));
      });
    }
    if ("hiddenContainers" in data && Array.isArray(data.hiddenContainers)) {
      conn.prepare("DELETE FROM hidden_containers").run();
      const stmt = conn.prepare(
        "INSERT INTO hidden_containers (name) VALUES (?)",
      );
      for (const name of data.hiddenContainers as unknown[]) {
        stmt.run(String(name));
      }
    }
    if ("hiddenStacks" in data && Array.isArray(data.hiddenStacks)) {
      conn.prepare("DELETE FROM hidden_stacks").run();
      const stmt = conn.prepare("INSERT INTO hidden_stacks (name) VALUES (?)");
      for (const name of data.hiddenStacks as unknown[]) {
        stmt.run(String(name));
      }
    }
    if ("collapsedStacks" in data && Array.isArray(data.collapsedStacks)) {
      conn.prepare("DELETE FROM collapsed_stacks").run();
      const stmt = conn.prepare(
        "INSERT INTO collapsed_stacks (stack_key) VALUES (?)",
      );
      for (const key of data.collapsedStacks as unknown[]) {
        stmt.run(String(key));
      }
    }
    if ("settings" in data && data.settings && typeof data.settings === "object") {
      const settings = data.settings as Record<string, unknown>;
      const stmt = conn.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      );
      for (const key of Object.keys(DEFAULT_SETTINGS) as Array<
        keyof typeof DEFAULT_SETTINGS
      >) {
        if (key in settings) {
          stmt.run(key, settings[key] ? "true" : "false");
        }
      }
    }
  });
  tx();
  return readPrefs(conn);
}

export function initDb(): void {
  getDb();
}
