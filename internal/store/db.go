package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

func OpenDB(path string) (*sql.DB, error) {
	dir := filepath.Dir(path)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	if err := checkWritable(path); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`PRAGMA journal_mode=WAL`); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(`PRAGMA busy_timeout=5000`); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(`PRAGMA foreign_keys=ON`); err != nil {
		db.Close()
		return nil, err
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func checkWritable(path string) error {
	if _, err := os.Stat(path); err == nil {
		f, err := os.OpenFile(path, os.O_RDWR, 0)
		if err != nil {
			return formatDBErr(path, err)
		}
		_ = f.Close()
		return nil
	}
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return formatDBErr(path, err)
	}
	_ = f.Close()
	return nil
}

func formatDBErr(path string, err error) error {
	uid := os.Getuid()
	return fmt.Errorf("DB_PATH não gravável: %s (uid=%d)", path, uid)
}

const schema = `
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
`

func migrate(db *sql.DB) error {
	if _, err := db.Exec(schema); err != nil {
		return err
	}
	cols, err := tableColumns(db, "projects")
	if err != nil {
		return err
	}
	if !hasColumn(cols, "access_url") {
		if _, err := db.Exec(`ALTER TABLE projects ADD COLUMN access_url TEXT NOT NULL DEFAULT ''`); err != nil {
			return err
		}
	}
	if !hasColumn(cols, "environment") {
		if _, err := db.Exec(`ALTER TABLE projects ADD COLUMN environment TEXT NOT NULL DEFAULT 'dev'`); err != nil {
			return err
		}
	}
	return nil
}

func tableColumns(db *sql.DB, table string) ([]string, error) {
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return nil, err
		}
		cols = append(cols, name)
	}
	return cols, rows.Err()
}

func hasColumn(cols []string, name string) bool {
	for _, c := range cols {
		if c == name {
			return true
		}
	}
	return false
}
