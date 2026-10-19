package mock

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/davi/homelab-app/internal/config"
	"github.com/davi/homelab-app/internal/model"
)

// Fixtures espelham src/lib/mock-dashboard-data.ts (v2) para que as duas versões
// possam ser comparadas lado a lado com os mesmos dados.

func Enabled() bool { return config.HomelabMock }

var (
	prefsMu sync.Mutex
	prefs   *model.Prefs
	bootAt  = time.Now().UnixMilli()
)

func c(id, name, image, status string, ports []int, stack string, health string, cpu, mem *float64) model.ContainerRow {
	var h *string
	if health != "" {
		h = &health
	}
	if ports == nil {
		ports = []int{}
	}
	return model.ContainerRow{ID: id, Name: name, Image: image, Status: status, Ports: ports, Stack: stack, Health: h, CPUPct: cpu, MemPct: mem}
}

func containers() []model.ContainerRow {
	return []model.ContainerRow{
		c("a1b2c3d4e5f6", "portainer", "portainer/portainer-ce:2.27.9", "Up 14 days (healthy)", []int{9443, 8000}, "portainer", "healthy", f64(0.8), f64(1.2)),
		c("b2c3d4e5f6a1", "grafana", "grafana/grafana:11.6.0", "Up 3 days", []int{3001}, "monitoring", "", f64(2.4), f64(3.1)),
		c("c3d4e5f6a1b2", "prometheus", "prom/prometheus:v3.2.1", "Up 3 days", []int{9090}, "monitoring", "", f64(4.7), f64(5.8)),
		c("d4e5f6a1b2c3", "node-exporter", "prom/node-exporter:v1.9.0", "Up 3 days", []int{9100}, "monitoring", "", f64(0.3), f64(0.2)),
		c("e5f6a1b2c3d4", "jellyfin", "jellyfin/jellyfin:10.10.6", "Up 8 days (healthy)", []int{8096}, "media", "healthy", f64(12.1), f64(8.4)),
		c("f6a1b2c3d4e5", "sonarr", "lscr.io/linuxserver/sonarr:4.0.14", "Up 8 days", []int{8989}, "media", "", f64(1.9), f64(2.6)),
		c("a1c2d3e4f5b6", "radarr", "lscr.io/linuxserver/radarr:5.22.4", "Up 8 days", []int{7878}, "media", "", f64(1.4), f64(2.1)),
		c("b1c2d3e4f5a6", "homelab-app", "homelab-app:production", "Up 2 hours (healthy)", []int{10000}, "homelab-app", "healthy", f64(6.2), f64(4.5)),
		c("c1d2e3f4a5b6", "postgres", "postgres:17-alpine", "Up 21 days", []int{5432}, "database", "", f64(3.8), f64(11.2)),
		c("d1e2f3a4b5c6", "redis", "redis:7-alpine", "Up 21 days", []int{6379}, "database", "", f64(0.6), f64(0.9)),
		c("e1f2a3b4c5d6", "cloudflared", "cloudflare/cloudflared:2025.4.0", "Up 5 days", nil, "sem stack", "", f64(0.4), f64(0.5)),
		c("f1a2b3c4d5e6", "watchtower", "containrrr/watchtower:1.7.1", "Exited (0) 2 hours ago", nil, "sem stack", "", nil, nil),
		c("a9b8c7d6e5f4", "uptime-kuma", "louislam/uptime-kuma:1", "Up 12 days (healthy)", []int{3002}, "monitoring", "healthy", f64(1.1), f64(1.8)),
	}
}

func PagePayload(host string) model.PagePayload {
	return model.PagePayload{
		Host:             host,
		Build:            config.ModuleBuild,
		LoadedBuild:      config.ModuleBuild,
		Error:            nil,
		Containers:       containers(),
		Meters:           buildMeters(),
		ContainerHistory: mockHistory(),
	}
}

func Prefs() model.Prefs {
	prefsMu.Lock()
	defer prefsMu.Unlock()
	if prefs == nil {
		prefs = &model.Prefs{
			Favorites:        []string{"jellyfin", "homelab-app", "grafana"},
			HiddenContainers: []string{},
			HiddenStacks:     []string{},
			CollapsedStacks:  []string{},
			Settings:         model.Settings{CompactView: true, TruncateNames: true, VerticalMeters: true},
		}
	}
	return *prefs
}

func UpdatePrefs(data map[string]interface{}) model.Prefs {
	cur := Prefs()
	if v, ok := data["favorites"].([]interface{}); ok {
		cur.Favorites = toStrings(v)
	}
	if v, ok := data["hiddenContainers"].([]interface{}); ok {
		cur.HiddenContainers = toStrings(v)
	}
	if v, ok := data["hiddenStacks"].([]interface{}); ok {
		cur.HiddenStacks = toStrings(v)
	}
	if v, ok := data["collapsedStacks"].([]interface{}); ok {
		cur.CollapsedStacks = toStrings(v)
	}
	if v, ok := data["settings"].(map[string]interface{}); ok {
		if x, ok := v["compactView"].(bool); ok {
			cur.Settings.CompactView = x
		}
		if x, ok := v["truncateNames"].(bool); ok {
			cur.Settings.TruncateNames = x
		}
		if x, ok := v["verticalMeters"].(bool); ok {
			cur.Settings.VerticalMeters = x
		}
	}
	prefsMu.Lock()
	prefs = &cur
	prefsMu.Unlock()
	return Prefs()
}

func Projects() []model.Project {
	return []model.Project{
		{ID: "proj-homelab", Name: "Homelab Dashboard", AccessURL: "https://homelab01.local:10000", Environment: "producao", Containers: []string{"homelab-app", "postgres", "redis"}},
		{ID: "proj-media", Name: "Mídia & Streaming", AccessURL: "https://jellyfin.homelab.local", Environment: "producao", Containers: []string{"jellyfin", "sonarr", "radarr"}},
		{ID: "proj-obs", Name: "Observabilidade", AccessURL: "https://grafana.homelab.local", Environment: "homolog", Containers: []string{"grafana", "prometheus", "node-exporter", "uptime-kuma"}},
		{ID: "proj-edge", Name: "Edge & Túneis", AccessURL: "", Environment: "dev", Containers: []string{"cloudflared", "portainer"}},
	}
}

func running() []model.ContainerRow {
	var out []model.ContainerRow
	for _, r := range containers() {
		if strings.HasPrefix(r.Status, "Up") {
			out = append(out, r)
		}
	}
	return out
}

func MeterDetail(kind string) map[string]interface{} {
	const gib = 1024 * 1024 * 1024
	switch kind {
	case "cpu":
		rs := running()
		sort.SliceStable(rs, func(i, j int) bool { return *rs[i].CPUPct > *rs[j].CPUPct })
		rows := make([]map[string]interface{}, 0, len(rs))
		for _, r := range rs {
			rows = append(rows, map[string]interface{}{"name": r.Name, "sub": r.Stack, "value": *r.CPUPct, "display": fmt.Sprintf("%.1f%%", *r.CPUPct)})
		}
		return map[string]interface{}{"kind": kind, "rows": rows, "total": 100}
	case "ram":
		rs := running()
		sort.SliceStable(rs, func(i, j int) bool { return *rs[i].MemPct > *rs[j].MemPct })
		rows := make([]map[string]interface{}, 0, len(rs))
		for _, r := range rs {
			rows = append(rows, map[string]interface{}{"name": r.Name, "sub": r.Stack, "value": *r.MemPct * gib * 0.01, "display": fmt.Sprintf("%.1f%% do host", *r.MemPct)})
		}
		return map[string]interface{}{"kind": kind, "rows": rows, "total": 32 * gib, "summary": map[string]string{"sub": "19.8 / 32 GB", "display": "62%"}}
	case "temp":
		return map[string]interface{}{"kind": kind, "rows": []map[string]interface{}{
			{"name": "Package", "value": 51, "display": "51°C"},
			{"name": "Core 0", "value": 48, "display": "48°C"},
			{"name": "Core 4", "value": 52, "display": "52°C"},
			{"name": "NVMe", "value": 44, "display": "44°C"},
		}}
	case "storage":
		sizes := []float64{12.4, 8.1, 6.7, 2.2, 45.8, 3.1, 2.9, 1.8, 22.6, 0.4, 0.2, 0.1, 1.5}
		rows := []map[string]interface{}{}
		for i, r := range containers() {
			s := 1.0
			if i < len(sizes) {
				s = sizes[i]
			}
			rows = append(rows, map[string]interface{}{"name": r.Name, "sub": r.Stack, "value": s * gib, "display": fmt.Sprintf("%.1f GB", s)})
		}
		return map[string]interface{}{"kind": kind, "rows": rows, "total": 712 * gib}
	default:
		return map[string]interface{}{"kind": kind, "error": "Dados mock indisponíveis para este medidor"}
	}
}

func f64(v float64) *float64 { return &v }

func toStrings(v []interface{}) []string {
	out := make([]string, 0, len(v))
	for _, x := range v {
		if s, ok := x.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func mockHistory() []model.ContainerLifecycleEvent {
	const minute = int64(60_000)
	return []model.ContainerLifecycleEvent{
		{At: bootAt - 8*minute, Name: "homelab-app", Stack: "homelab-app", Kind: "restarted"},
		{At: bootAt - 42*minute, Name: "watchtower", Stack: "sem stack", Kind: "started"},
		{At: bootAt - 3*60*minute, Name: "jellyfin", Stack: "media", Kind: "restarted"},
		{At: bootAt - 26*60*minute, Name: "postgres", Stack: "database", Kind: "started"},
	}
}

// Mesmas regras de cor de host-metrics.ts.
func meterColor(pct float64) string {
	switch {
	case pct >= 85:
		return "#f85149"
	case pct >= 65:
		return "#e3b341"
	default:
		return "#3fb950"
	}
}

func buildMeters() []model.Meter {
	const cpu, ramPct, tempC, storagePct = 38.0, 62.0, 51.0, 58.0
	tempPct := math.Round(math.Min(100, math.Max(0, tempC)))
	return []model.Meter{
		{"label": "CPU", "display": "38%", "sub": "12 cores", "showSub": true, "color": meterColor(cpu), "barWidth": "38%", "showBar": true, "showChart": true, "chartKey": "cpu", "pct": cpu, "showCaption": false, "caption": "", "detailKey": "cpu"},
		{"label": "RAM", "display": "62%", "sub": "19.8 / 32 GB", "showSub": true, "color": meterColor(ramPct), "barWidth": "62%", "showBar": true, "showChart": true, "chartKey": "ram", "pct": ramPct, "showCaption": false, "caption": "", "detailKey": "ram"},
		{"label": "Temperatura", "display": "51°C", "sub": "Package · coretemp", "showSub": true, "color": meterColor(tempC), "barWidth": "51%", "showBar": true, "showChart": true, "chartKey": "temp", "pct": tempPct, "showCaption": false, "caption": "", "detailKey": "temp"},
		agentsMeter(),
		{"label": "Armazenamento", "type": "storage", "display": "58%", "sub": "412.4 / 712 GB", "showSub": true, "color": meterColor(storagePct), "barWidth": "58%", "showBar": false, "showCaption": false, "caption": "", "detailKey": "storage",
			"main": model.StorageMount{Path: "/", Label: "Raiz (nvme0n1p2)", Pct: 61, UsedGB: 380.2, TotalGB: 620, Color: "#3fb950"},
			"mounts": []model.StorageMount{
				{Path: "/mnt/nas", Label: "NAS (ZFS)", Pct: 72, UsedGB: 28.4, TotalGB: 39.5, Color: "#6cb6ff"},
				{Path: "/mnt/backup", Label: "Backup USB", Pct: 44, UsedGB: 3.9, TotalGB: 8.9, Color: "#a371f7"},
			}},
	}
}

func agentsMeter() model.Meter {
	const minute = int64(60_000)
	session := func(kind, label string, pid int, parent, cwd string, age int64, uptime string, procs int, cpu float64, cpuDisplay string, mem uint64, memDisplay string) model.AgentSession {
		return model.AgentSession{
			ID: fmt.Sprintf("%s-%d", kind, pid), Parent: parent, Kind: kind, Label: label, PID: pid, Cwd: cwd,
			StartedAt: bootAt - age*minute, Uptime: uptime, Procs: procs,
			CPUPct: cpu, CPUDisplay: cpuDisplay, MemBytes: mem, MemDisplay: memDisplay, Color: meterColor(cpu),
		}
	}
	const mib = 1024 * 1024
	sessions := []model.AgentSession{
		session("cursor", "Cursor Agent", 1977128, "", "~/projeto-biblioteca-fotos", 73, "1 h 13 min", 3, 1.1, "1.1%", 413*mib, "413.3 MB"),
		session("claude", "Claude Code", 2013899, "", "~/workspace/sweetcred", 55, "55 min", 6, 7.0, "7.0%", 453*mib, "453.4 MB"),
		session("claude", "Claude Code", 2014520, "claude-2013899", "~/workspace/sweetcred", 4, "4 min", 1, 18.3, "18.3%", 212*mib, "212.0 MB"),
		session("cursor", "Cursor Agent", 2026846, "", "~/workspace/sweetcred", 41, "41 min", 2, 12.7, "12.7%", 704*mib, "704.0 MB"),
		session("claude", "Claude Code", 2129967, "", "~/workspace/homelab-app", 11, "11 min", 1, 5.5, "5.5%", 306*mib, "306.2 MB"),
	}
	return model.Meter{
		"label": "Agent Sessions", "type": "agents", "display": "5", "sub": "4 sessões · 1 subagent · 2.0 GB",
		"showSub": true, "color": "oklch(0.708 0 0)", "barWidth": "0%", "showBar": false, "showCaption": false, "caption": "",
		"sessions": sessions,
	}
}
