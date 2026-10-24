package metrics

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/davi/homelab-app/internal/docker"
)

func meterDetailFromPairs(pairs map[string]ContainerMetric, stackByName map[string]string, ramTotal uint64) (map[string]interface{}, map[string]interface{}) {
	cpuRows := []map[string]interface{}{}
	ramRows := []map[string]interface{}{}
	for name, m := range pairs {
		pct := 0.0
		if ramTotal > 0 {
			pct = (m.MemBytes / float64(ramTotal)) * 100
		}
		cpuRows = append(cpuRows, map[string]interface{}{
			"name": name, "sub": stackByName[name], "value": m.CPUPct, "display": FormatPct(m.CPUPct),
		})
		ramRows = append(ramRows, map[string]interface{}{
			"name": name, "sub": stackByName[name], "value": m.MemBytes,
			"display": FormatBytes(m.MemBytes) + " · " + FormatPct(pct),
		})
	}
	sort.Slice(cpuRows, func(i, j int) bool { return toFloat(cpuRows[i]["value"]) > toFloat(cpuRows[j]["value"]) })
	sort.Slice(ramRows, func(i, j int) bool { return toFloat(ramRows[i]["value"]) > toFloat(ramRows[j]["value"]) })
	ramPct, usedGB, totalGB := RamStats()
	return map[string]interface{}{"rows": cpuRows, "total": 100},
		map[string]interface{}{
			"rows":  ramRows,
			"total": max(1, float64(ramTotal)),
			"summary": map[string]interface{}{
				"sub":     strconv.FormatFloat(usedGB, 'f', 1, 64) + " / " + strconv.FormatFloat(totalGB, 'f', 0, 64) + " GB",
				"display": strconv.Itoa(ramPct) + "%",
			},
		}
}

func toFloat(v interface{}) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case uint64:
		return float64(t)
	default:
		return 0
	}
}

// TemperatureSensorDetails é a porta de temperatureSensorDetails (host-metrics.ts, v2):
// sensores hwmon ("chip · label") e zonas térmicas ("thermal_zoneN · tipo"). /host/sys e
// /sys expõem o mesmo hardware, então a deduplicação é por rótulo (a v2 listava em dobro).
func TemperatureSensorDetails() []map[string]interface{} {
	rows := []map[string]interface{}{}
	seen := map[string]bool{}
	add := func(label string, milli int) {
		if seen[label] {
			return
		}
		seen[label] = true
		c := float64(milli) / 1000
		rows = append(rows, map[string]interface{}{
			"name": label, "value": c, "display": strconv.FormatFloat(math.Round(c), 'f', 0, 64) + "°C",
		})
	}
	for _, root := range sysfsRoots() {
		hwmonDir := filepath.Join(root, "class", "hwmon")
		if entries, err := os.ReadDir(hwmonDir); err == nil {
			for _, e := range entries {
				if !strings.HasPrefix(e.Name(), "hwmon") {
					continue
				}
				base := filepath.Join(hwmonDir, e.Name())
				chip := "sensor"
				if b, err := os.ReadFile(filepath.Join(base, "name")); err == nil && strings.TrimSpace(string(b)) != "" {
					chip = strings.TrimSpace(string(b))
				}
				files, _ := os.ReadDir(base)
				for _, f := range files {
					name := f.Name()
					if !strings.HasPrefix(name, "temp") || !strings.HasSuffix(name, "_input") {
						continue
					}
					v := readTempMillidegrees(filepath.Join(base, name))
					if v == nil {
						continue
					}
					label := chip
					if b, err := os.ReadFile(filepath.Join(base, strings.TrimSuffix(name, "_input")+"_label")); err == nil {
						if part := strings.TrimSpace(string(b)); part != "" {
							label = chip + " · " + part
						}
					}
					add(label, *v)
				}
			}
		}
		thermalDir := filepath.Join(root, "class", "thermal")
		if zones, err := os.ReadDir(thermalDir); err == nil {
			for _, z := range zones {
				if !strings.HasPrefix(z.Name(), "thermal_zone") {
					continue
				}
				base := filepath.Join(thermalDir, z.Name())
				zoneType := "thermal"
				if b, err := os.ReadFile(filepath.Join(base, "type")); err == nil && strings.TrimSpace(string(b)) != "" {
					zoneType = strings.TrimSpace(string(b))
				}
				if v := readTempMillidegrees(filepath.Join(base, "temp")); v != nil {
					add(z.Name()+" · "+zoneType, *v)
				}
			}
		}
	}
	sort.SliceStable(rows, func(i, j int) bool { return toFloat(rows[i]["value"]) > toFloat(rows[j]["value"]) })
	return rows
}

// MeterDetailStorage é a porta de meterDetailStorage (meter-details.ts, v2): uso de disco
// por container (camada gravável + imagem + volumes), imagens, volumes e build cache.
func MeterDetailStorage(ctx context.Context, client *docker.Client) (map[string]interface{}, error) {
	body, err := client.Get(ctx, "/system/df")
	if err != nil {
		return nil, err
	}
	var df struct {
		Containers []struct {
			ID         string            `json:"Id"`
			Names      []string          `json:"Names"`
			SizeRw     float64           `json:"SizeRw"`
			SizeRootFs float64           `json:"SizeRootFs"`
			Labels     map[string]string `json:"Labels"`
			Mounts     []struct {
				Type string `json:"Type"`
				Name string `json:"Name"`
			} `json:"Mounts"`
		} `json:"Containers"`
		Images []struct {
			ID         string   `json:"Id"`
			RepoTags   []string `json:"RepoTags"`
			Size       float64  `json:"Size"`
			Containers int      `json:"Containers"`
		} `json:"Images"`
		Volumes []struct {
			Name      string `json:"Name"`
			UsageData struct {
				Size     float64 `json:"Size"`
				RefCount int     `json:"RefCount"`
			} `json:"UsageData"`
		} `json:"Volumes"`
		BuildCache []struct {
			ID          string  `json:"ID"`
			Description string  `json:"Description"`
			Size        float64 `json:"Size"`
			Shared      bool    `json:"Shared"`
		} `json:"BuildCache"`
	}
	if err := json.Unmarshal(body, &df); err != nil {
		return nil, err
	}

	volumeSizes := map[string]float64{}
	for _, v := range df.Volumes {
		volumeSizes[v.Name] = math.Max(0, v.UsageData.Size)
	}

	containers := []map[string]interface{}{}
	for _, c := range df.Containers {
		var volumes float64
		for _, m := range c.Mounts {
			if strings.EqualFold(m.Type, "volume") {
				volumes += volumeSizes[m.Name]
			}
		}
		total := c.SizeRw + c.SizeRootFs + volumes
		name := c.ID
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}
		stack := docker.StackFromLabels(c.Labels).Name
		containers = append(containers, map[string]interface{}{
			"name": name, "sub": stack, "value": total, "display": FormatBytes(total),
			"writable": FormatBytes(c.SizeRw), "image": FormatBytes(c.SizeRootFs), "volumes": FormatBytes(volumes),
		})
	}

	images := []map[string]interface{}{}
	for _, im := range df.Images {
		name := "sem tag"
		switch {
		case len(im.RepoTags) > 0:
			name = im.RepoTags[0]
		case strings.HasPrefix(im.ID, "sha256:") && len(im.ID) >= 19:
			name = im.ID[7:19]
		case im.ID != "":
			name = im.ID
		}
		images = append(images, map[string]interface{}{
			"name": name, "sub": strconv.Itoa(im.Containers) + " container(s)", "value": im.Size, "display": FormatBytes(im.Size),
		})
	}

	volumes := []map[string]interface{}{}
	for _, v := range df.Volumes {
		name := v.Name
		if name == "" {
			name = "volume"
		}
		size := math.Max(0, v.UsageData.Size) // -1 = tamanho não calculado
		volumes = append(volumes, map[string]interface{}{
			"name": name, "sub": strconv.Itoa(max0(v.UsageData.RefCount)) + " referência(s)", "value": size, "display": FormatBytes(size),
		})
	}

	builds := []map[string]interface{}{}
	for _, b := range df.BuildCache {
		name := b.Description
		if name == "" {
			name = b.ID
		}
		if name == "" {
			name = "build cache"
		}
		sub := "exclusivo"
		if b.Shared {
			sub = "compartilhado"
		}
		builds = append(builds, map[string]interface{}{"name": name, "sub": sub, "value": b.Size, "display": FormatBytes(b.Size)})
	}

	for _, rows := range [][]map[string]interface{}{containers, images, volumes, builds} {
		sort.SliceStable(rows, func(i, j int) bool { return toFloat(rows[i]["value"]) > toFloat(rows[j]["value"]) })
	}

	main, extras := StorageMounts()
	_, _, total := StorageAggregate(main, extras)
	return map[string]interface{}{
		"total": math.Max(1, math.Floor(total*1024*1024*1024)),
		"sections": []map[string]interface{}{
			{"title": "Containers", "rows": containers, "columns": []string{"writable", "image", "volumes"}},
			{"title": "Imagens", "rows": images},
			{"title": "Volumes", "rows": volumes},
			{"title": "Build cache", "rows": builds},
		},
	}, nil
}

func max0(n int) int {
	if n < 0 {
		return 0
	}
	return n
}

func toString(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
