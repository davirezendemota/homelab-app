package store

import (
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/davi/homelab-app/internal/model"
)

func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func ParseProjectEnvironment(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "homolog":
		return "homolog"
	case "producao", "produção":
		return "producao"
	default:
		return "dev"
	}
}

func NormalizeAccessURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", nil
	}
	withScheme := trimmed
	if !strings.HasPrefix(strings.ToLower(trimmed), "http://") && !strings.HasPrefix(strings.ToLower(trimmed), "https://") {
		withScheme = "https://" + trimmed
	}
	u, err := url.Parse(withScheme)
	if err != nil {
		return "", errors.New("Link de acesso inválido")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", errors.New("Link deve usar http ou https")
	}
	return u.String(), nil
}

func ListProjects(db *sql.DB) ([]model.Project, error) {
	rows, err := db.Query(`SELECT id, name, access_url, environment FROM projects ORDER BY position ASC, name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Project
	for rows.Next() {
		var p model.Project
		var env string
		if err := rows.Scan(&p.ID, &p.Name, &p.AccessURL, &env); err != nil {
			return nil, err
		}
		p.Environment = ParseProjectEnvironment(env)
		p.Containers = []string{}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// O pool tem uma única conexão (SetMaxOpenConns(1)): uma query aninhada enquanto
	// `rows` está aberto travaria para sempre. Fecha antes de buscar os containers.
	rows.Close()

	byProject, err := allProjectContainers(db)
	if err != nil {
		return nil, err
	}
	for i := range out {
		if names, ok := byProject[out[i].ID]; ok {
			out[i].Containers = names
		}
	}
	return out, nil
}

func allProjectContainers(db *sql.DB) (map[string][]string, error) {
	rows, err := db.Query(`SELECT project_id, container_name FROM project_containers ORDER BY project_id, position ASC, container_name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]string{}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		out[id] = append(out[id], name)
	}
	return out, rows.Err()
}

func CreateProject(db *sql.DB, name, accessURL, environment string) (model.Project, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return model.Project{}, errors.New("Nome do projeto é obrigatório")
	}
	link, err := NormalizeAccessURL(accessURL)
	if err != nil {
		return model.Project{}, err
	}
	env := ParseProjectEnvironment(environment)
	var maxPos int
	if err := db.QueryRow(`SELECT COALESCE(MAX(position), -1) FROM projects`).Scan(&maxPos); err != nil {
		return model.Project{}, err
	}
	id := newUUID()
	if _, err := db.Exec(`INSERT INTO projects (id, name, position, access_url, environment) VALUES (?, ?, ?, ?, ?)`, id, trimmed, maxPos+1, link, env); err != nil {
		return model.Project{}, err
	}
	return model.Project{ID: id, Name: trimmed, AccessURL: link, Environment: env, Containers: []string{}}, nil
}

func UpdateProject(db *sql.DB, id string, patch map[string]interface{}) (model.Project, error) {
	var exists string
	if err := db.QueryRow(`SELECT id FROM projects WHERE id = ?`, id).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return model.Project{}, errors.New("Projeto não encontrado")
		}
		return model.Project{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return model.Project{}, err
	}
	defer tx.Rollback()

	if v, ok := patch["name"]; ok {
		trimmed := strings.TrimSpace(toString(v))
		if trimmed == "" {
			return model.Project{}, errors.New("Nome do projeto é obrigatório")
		}
		if _, err := tx.Exec(`UPDATE projects SET name = ? WHERE id = ?`, trimmed, id); err != nil {
			return model.Project{}, err
		}
	}
	if v, ok := patch["accessUrl"]; ok {
		link, err := NormalizeAccessURL(toString(v))
		if err != nil {
			return model.Project{}, err
		}
		if _, err := tx.Exec(`UPDATE projects SET access_url = ? WHERE id = ?`, link, id); err != nil {
			return model.Project{}, err
		}
	}
	if v, ok := patch["environment"]; ok {
		env := ParseProjectEnvironment(toString(v))
		if _, err := tx.Exec(`UPDATE projects SET environment = ? WHERE id = ?`, env, id); err != nil {
			return model.Project{}, err
		}
	}
	if v, ok := patch["containers"]; ok {
		if arr, ok := v.([]interface{}); ok {
			seen := map[string]bool{}
			unique := []string{}
			for _, raw := range arr {
				name := strings.TrimSpace(toString(raw))
				if name == "" || seen[name] {
					continue
				}
				seen[name] = true
				unique = append(unique, name)
			}
			if _, err := tx.Exec(`DELETE FROM project_containers WHERE project_id = ?`, id); err != nil {
				return model.Project{}, err
			}
			stmt, err := tx.Prepare(`INSERT INTO project_containers (project_id, container_name, position) VALUES (?, ?, ?)`)
			if err != nil {
				return model.Project{}, err
			}
			defer stmt.Close()
			for i, name := range unique {
				if _, err := stmt.Exec(id, name, i); err != nil {
					return model.Project{}, err
				}
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return model.Project{}, err
	}
	projects, err := ListProjects(db)
	if err != nil {
		return model.Project{}, err
	}
	for _, p := range projects {
		if p.ID == id {
			return p, nil
		}
	}
	return model.Project{}, errors.New("Projeto não encontrado")
}

func DeleteProject(db *sql.DB, id string) error {
	res, err := db.Exec(`DELETE FROM projects WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("Projeto não encontrado")
	}
	return nil
}

func ReorderProjects(db *sql.DB, orderedIDs []string) ([]model.Project, error) {
	existing, err := ListProjects(db)
	if err != nil {
		return nil, err
	}
	if len(orderedIDs) != len(existing) {
		return nil, errors.New("Lista de ordem incompleta")
	}
	known := map[string]bool{}
	for _, p := range existing {
		known[p.ID] = true
	}
	for _, id := range orderedIDs {
		if !known[id] {
			return nil, errors.New("Projeto inválido na ordem")
		}
	}
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(`UPDATE projects SET position = ? WHERE id = ?`)
	if err != nil {
		return nil, err
	}
	defer stmt.Close()
	for pos, id := range orderedIDs {
		if _, err := stmt.Exec(pos, id); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return ListProjects(db)
}
