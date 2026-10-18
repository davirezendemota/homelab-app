package metrics

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/davi/homelab-app/internal/config"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// Temperatura principal = maior leitura do hwmon preferido (antes pegava a primeira).
func TestTemperatureStatsUsesMaxOfPreferred(t *testing.T) {
	root := t.TempDir()
	old := config.HostRoot
	oldSys := localSysfs
	config.HostRoot = root
	localSysfs = filepath.Join(root, "nada")
	defer func() { config.HostRoot, localSysfs = old, oldSys }()
	hw := filepath.Join(root, "sys/class/hwmon/hwmon0")
	writeFile(t, filepath.Join(hw, "name"), "coretemp\n")
	writeFile(t, filepath.Join(hw, "temp1_input"), "41000\n")
	writeFile(t, filepath.Join(hw, "temp2_input"), "78500\n")
	writeFile(t, filepath.Join(hw, "temp2_label"), "Core 3\n")

	c, label := TemperatureStats()
	if c == nil || *c != 78.5 || label != "CPU" {
		t.Fatalf("got %v %q, want 78.5 CPU", c, label)
	}
	rows := TemperatureSensorDetails()
	found := false
	for _, r := range rows {
		if r["name"] == "coretemp · Core 3" && r["display"] == "79°C" {
			found = true
		}
	}
	if !found {
		t.Fatalf("detalhe sem rótulo/arredondamento da v2: %v", rows)
	}
}
