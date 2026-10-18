package store

import (
	"database/sql"

	"github.com/davi/homelab-app/internal/model"
)

var defaultSettings = model.Settings{
	CompactView:    false,
	TruncateNames:  false,
	VerticalMeters: false,
}

func ReadPrefs(db *sql.DB) (model.Prefs, error) {
	favorites, err := readStrings(db, `SELECT name FROM favorites ORDER BY position ASC`)
	if err != nil {
		return model.Prefs{}, err
	}
	hiddenContainers, err := readStrings(db, `SELECT name FROM hidden_containers ORDER BY name`)
	if err != nil {
		return model.Prefs{}, err
	}
	hiddenStacks, err := readStrings(db, `SELECT name FROM hidden_stacks ORDER BY name`)
	if err != nil {
		return model.Prefs{}, err
	}
	collapsed, err := readStrings(db, `SELECT stack_key FROM collapsed_stacks ORDER BY stack_key`)
	if err != nil {
		return model.Prefs{}, err
	}
	settings := defaultSettings
	rows, err := db.Query(`SELECT key, value FROM settings`)
	if err != nil {
		return model.Prefs{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return model.Prefs{}, err
		}
		switch key {
		case "compactView":
			settings.CompactView = value == "true"
		case "truncateNames":
			settings.TruncateNames = value == "true"
		case "verticalMeters":
			settings.VerticalMeters = value == "true"
		}
	}
	return model.Prefs{
		Favorites:        favorites,
		HiddenContainers: hiddenContainers,
		HiddenStacks:     hiddenStacks,
		CollapsedStacks:  collapsed,
		Settings:         settings,
	}, nil
}

func UpdatePrefs(db *sql.DB, data map[string]interface{}) (model.Prefs, error) {
	tx, err := db.Begin()
	if err != nil {
		return model.Prefs{}, err
	}
	defer tx.Rollback()

	if v, ok := data["favorites"]; ok {
		if arr, ok := v.([]interface{}); ok {
			if _, err := tx.Exec(`DELETE FROM favorites`); err != nil {
				return model.Prefs{}, err
			}
			stmt, err := tx.Prepare(`INSERT INTO favorites (position, name) VALUES (?, ?)`)
			if err != nil {
				return model.Prefs{}, err
			}
			defer stmt.Close()
			for i, name := range arr {
				if _, err := stmt.Exec(i, toString(name)); err != nil {
					return model.Prefs{}, err
				}
			}
		}
	}
	if v, ok := data["hiddenContainers"]; ok {
		if arr, ok := v.([]interface{}); ok {
			if _, err := tx.Exec(`DELETE FROM hidden_containers`); err != nil {
				return model.Prefs{}, err
			}
			stmt, err := tx.Prepare(`INSERT INTO hidden_containers (name) VALUES (?)`)
			if err != nil {
				return model.Prefs{}, err
			}
			defer stmt.Close()
			for _, name := range arr {
				if _, err := stmt.Exec(toString(name)); err != nil {
					return model.Prefs{}, err
				}
			}
		}
	}
	if v, ok := data["hiddenStacks"]; ok {
		if arr, ok := v.([]interface{}); ok {
			if _, err := tx.Exec(`DELETE FROM hidden_stacks`); err != nil {
				return model.Prefs{}, err
			}
			stmt, err := tx.Prepare(`INSERT INTO hidden_stacks (name) VALUES (?)`)
			if err != nil {
				return model.Prefs{}, err
			}
			defer stmt.Close()
			for _, name := range arr {
				if _, err := stmt.Exec(toString(name)); err != nil {
					return model.Prefs{}, err
				}
			}
		}
	}
	if v, ok := data["collapsedStacks"]; ok {
		if arr, ok := v.([]interface{}); ok {
			if _, err := tx.Exec(`DELETE FROM collapsed_stacks`); err != nil {
				return model.Prefs{}, err
			}
			stmt, err := tx.Prepare(`INSERT INTO collapsed_stacks (stack_key) VALUES (?)`)
			if err != nil {
				return model.Prefs{}, err
			}
			defer stmt.Close()
			for _, key := range arr {
				if _, err := stmt.Exec(toString(key)); err != nil {
					return model.Prefs{}, err
				}
			}
		}
	}
	if v, ok := data["settings"]; ok {
		if m, ok := v.(map[string]interface{}); ok {
			stmt, err := tx.Prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
			if err != nil {
				return model.Prefs{}, err
			}
			defer stmt.Close()
			for _, key := range []string{"compactView", "truncateNames", "verticalMeters"} {
				if raw, ok := m[key]; ok {
					val := "false"
					if toBool(raw) {
						val = "true"
					}
					if _, err := stmt.Exec(key, val); err != nil {
						return model.Prefs{}, err
					}
				}
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return model.Prefs{}, err
	}
	return ReadPrefs(db)
}

func readStrings(db *sql.DB, query string) ([]string, error) {
	rows, err := db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{} // nunca null no JSON: o contrato da v2 é sempre um array
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func toString(v interface{}) string {
	switch t := v.(type) {
	case string:
		return t
	default:
		return ""
	}
}

func toBool(v interface{}) bool {
	switch t := v.(type) {
	case bool:
		return t
	default:
		return false
	}
}
