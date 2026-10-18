package store

import (
	"path/filepath"
	"testing"
	"time"
)

// Regressão: ListProjects fazia uma query aninhada com o cursor externo aberto e, com
// SetMaxOpenConns(1), travava para sempre assim que existia ao menos um projeto.
func TestListProjectsWithContainersDoesNotDeadlock(t *testing.T) {
	db, err := OpenDB(filepath.Join(t.TempDir(), "homepage.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	for _, name := range []string{"Alpha", "Beta"} {
		p, err := CreateProject(db, name, "", "dev")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := UpdateProject(db, p.ID, map[string]interface{}{"containers": []interface{}{"web", "db", "web"}}); err != nil {
			t.Fatal(err)
		}
	}

	done := make(chan struct{})
	var got int
	var containers []string
	go func() {
		defer close(done)
		ps, err := ListProjects(db)
		if err != nil {
			t.Error(err)
			return
		}
		got = len(ps)
		if len(ps) > 0 {
			containers = ps[0].Containers
		}
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("ListProjects travou (deadlock no pool de conexão única)")
	}
	if got != 2 {
		t.Fatalf("projects = %d, want 2", got)
	}
	if len(containers) != 2 || containers[0] != "web" || containers[1] != "db" {
		t.Fatalf("containers = %v, want [web db]", containers)
	}
}

func TestReadPrefsEmptyListsAreNotNil(t *testing.T) {
	db, err := OpenDB(filepath.Join(t.TempDir(), "homepage.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	p, err := ReadPrefs(db)
	if err != nil {
		t.Fatal(err)
	}
	if p.Favorites == nil || p.HiddenContainers == nil || p.HiddenStacks == nil || p.CollapsedStacks == nil {
		t.Fatalf("listas vazias devem ser [] e não null: %+v", p)
	}
}
