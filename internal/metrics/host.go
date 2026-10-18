package metrics

import (
	"bufio"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/davi/homelab-app/internal/config"
	"github.com/davi/homelab-app/internal/model"
)

const (
	mainDiskColor = "#3fb950"
	mutedFG       = "oklch(0.708 0 0)"
)

var mountColors = []string{"#6cb6ff", "#a371f7", "#e3b341", "#f778ba", "#56d4dd", "#ffa657"}

var (
	cpuMu       sync.Mutex
	lastCPU     cpuSample
	pseudoFS    = map[string]bool{"proc": true, "sysfs": true, "devtmpfs": true, "tmpfs": true, "cgroup2": true}
	preferredHW = map[string]bool{"coretemp": true, "k10temp": true, "zenpower": true, "applesmc": true, "cpu_thermal": true, "soc_thermal": true}
	skipHW      = map[string]bool{"acpitz": true}
	skipMounts  = map[string]bool{"/boot": true, "/boot/efi": true}
)

type cpuSample struct {
	total uint64
	idle  uint64
	ok    bool
}

func RamStats() (pct int, usedGB, totalGB float64) {
	info := map[string]uint64{}
	data, err := os.ReadFile(hostPath("/proc/meminfo"))
	if err != nil {
		return 0, 0, 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		if key != "MemTotal" && key != "MemAvailable" {
			continue
		}
		fields := strings.Fields(parts[1])
		if len(fields) == 0 {
			continue
		}
		v, _ := strconv.ParseUint(fields[0], 10, 64)
		info[key] = v
	}
	totalKb := info["MemTotal"]
	availKb := info["MemAvailable"]
	if totalKb == 0 {
		return 0, 0, 0
	}
	usedKb := totalKb - availKb
	if usedKb < 0 {
		usedKb = 0
	}
	pct = int((usedKb * 100) / totalKb)
	return pct, float64(usedKb) / (1024 * 1024), float64(totalKb) / (1024 * 1024)
}

func CPUPercent() (pct int, cores int) {
	cores = runtime.NumCPU()
	cpuMu.Lock()
	defer cpuMu.Unlock()
	total, idle, err := readCPUTimes()
	if err != nil {
		return 0, cores
	}
	if !lastCPU.ok {
		lastCPU = cpuSample{total: total, idle: idle, ok: true}
		return 0, cores
	}
	dt := total - lastCPU.total
	di := idle - lastCPU.idle
	lastCPU = cpuSample{total: total, idle: idle, ok: true}
	if dt == 0 {
		return 0, cores
	}
	p := int((1 - float64(di)/float64(dt)) * 100)
	if p < 0 {
		p = 0
	}
	if p > 100 {
		p = 100
	}
	return p, cores
}

func readCPUTimes() (total, idle uint64, err error) {
	data, err := os.ReadFile(hostPath("/proc/stat"))
	if err != nil {
		return 0, 0, err
	}
	line := strings.Split(string(data), "\n")[0]
	fields := strings.Fields(line)
	if len(fields) < 5 {
		return 0, 0, err
	}
	var parts []uint64
	for _, f := range fields[1:] {
		v, _ := strconv.ParseUint(f, 10, 64)
		parts = append(parts, v)
	}
	for _, v := range parts {
		total += v
	}
	idle = parts[3]
	if len(parts) > 4 {
		idle += parts[4]
	}
	return total, idle, nil
}

func hostPath(p string) string {
	if config.HostRoot != "" && config.HostRoot != "/" {
		if p == "/proc/stat" || p == "/proc/meminfo" || p == "/proc/mounts" {
			return config.HostRoot + p
		}
	}
	return p
}

// TemperatureStats segue host-metrics.ts (v2): em cada grupo, vale a MAIOR leitura —
// hwmon preferido (coretemp, k10temp…), zona térmica de CPU/pkg, outro hwmon (exceto
// acpitz) e, por fim, qualquer zona térmica ("Sistema").
func TemperatureStats() (celsius *float64, label string) {
	var hwmon [][2]string
	var thermal [][2]string
	for _, root := range sysfsRoots() {
		hwmon = append(hwmon, hwmonReadings(root)...)
		thermal = append(thermal, thermalReadings(root)...)
	}
	maxOf := func(rows [][2]string, keep func(name string) bool) *float64 {
		var best *float64
		for _, row := range rows {
			if !keep(row[0]) {
				continue
			}
			v, err := strconv.ParseFloat(row[1], 64)
			if err != nil {
				continue
			}
			c := v / 1000
			if best == nil || c > *best {
				best = &c
			}
		}
		return best
	}
	if c := maxOf(hwmon, func(n string) bool { return preferredHW[n] }); c != nil {
		return c, "CPU"
	}
	if c := maxOf(thermal, func(n string) bool {
		n = strings.ToLower(n)
		return strings.Contains(n, "pkg") || strings.Contains(n, "cpu")
	}); c != nil {
		return c, "CPU"
	}
	if c := maxOf(hwmon, func(n string) bool { return !skipHW[n] }); c != nil {
		return c, "CPU"
	}
	if c := maxOf(thermal, func(string) bool { return true }); c != nil {
		return c, "Sistema"
	}
	return nil, ""
}

// localSysfs é o sysfs do próprio container (substituível nos testes).
var localSysfs = "/sys"

func sysfsRoots() []string {
	if usingHostStorage() {
		return []string{filepath.Join(config.HostRoot, "sys"), localSysfs}
	}
	return []string{localSysfs}
}

func usingHostStorage() bool {
	return config.HostRoot != "" && config.HostRoot != "/" && dirExists(config.HostRoot)
}

func dirExists(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && fi.IsDir()
}

func hwmonReadings(root string) [][2]string {
	dir := filepath.Join(root, "class", "hwmon")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var rows [][2]string
	for _, e := range entries {
		if !strings.HasPrefix(e.Name(), "hwmon") {
			continue
		}
		base := filepath.Join(dir, e.Name())
		chip := "sensor"
		if b, err := os.ReadFile(filepath.Join(base, "name")); err == nil {
			chip = strings.TrimSpace(string(b))
		}
		files, _ := os.ReadDir(base)
		for _, f := range files {
			name := f.Name()
			if strings.HasPrefix(name, "temp") && strings.HasSuffix(name, "_input") {
				if v := readTempMillidegrees(filepath.Join(base, name)); v != nil {
					rows = append(rows, [2]string{chip, strconv.Itoa(*v)})
				}
			}
		}
	}
	return rows
}

func thermalReadings(root string) [][2]string {
	dir := filepath.Join(root, "class", "thermal")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var rows [][2]string
	for _, e := range entries {
		if !strings.HasPrefix(e.Name(), "thermal_zone") {
			continue
		}
		base := filepath.Join(dir, e.Name())
		zone := "thermal"
		if b, err := os.ReadFile(filepath.Join(base, "type")); err == nil {
			zone = strings.TrimSpace(string(b))
		}
		if v := readTempMillidegrees(filepath.Join(base, "temp")); v != nil {
			rows = append(rows, [2]string{zone, strconv.Itoa(*v)})
		}
	}
	return rows
}

func readTempMillidegrees(path string) *int {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	v, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil {
		return nil
	}
	return &v
}

func MeterColor(pct float64) string {
	if pct >= 85 {
		return "#f85149"
	}
	if pct >= 65 {
		return "#e3b341"
	}
	return "#3fb950"
}

func TemperatureColor(c float64) string { return MeterColor(c) }

func StorageMounts() (model.StorageMount, []model.StorageMount) {
	if usingHostStorage() {
		return storageFromHost(config.HostRoot)
	}
	return storageFromProc()
}

func storageFromHost(hostRoot string) (model.StorageMount, []model.StorageMount) {
	rows := []struct {
		path  string
		pct   int
		used  float64
		total float64
	}{}
	seenDev := map[uint64]bool{}
	for _, mp := range discoverMountpoints(hostRoot) {
		if _, err := os.Stat(mp); err != nil {
			continue
		}
		dev, ok := deviceOf(mp)
		if !ok || seenDev[dev] {
			continue
		}
		pct, used, total := mountUsage(mp)
		if total == 0 {
			continue
		}
		seenDev[dev] = true
		display := displayPath(mp, hostRoot)
		if skipMounts[display] {
			continue
		}
		rows = append(rows, struct {
			path  string
			pct   int
			used  float64
			total float64
		}{display, pct, used, total})
	}
	return splitStorage(rows)
}

func storageFromProc() (model.StorageMount, []model.StorageMount) {
	rows := []struct {
		path  string
		pct   int
		used  float64
		total float64
	}{}
	seen := map[string]bool{}
	data, err := os.ReadFile("/proc/mounts")
	if err != nil {
		main := model.StorageMount{Path: "/", Label: "/", Color: mainDiskColor}
		return main, nil
	}
	sc := bufio.NewScanner(strings.NewReader(string(data)))
	for sc.Scan() {
		parts := strings.Fields(sc.Text())
		if len(parts) < 3 {
			continue
		}
		mp, fstype := parts[1], parts[2]
		if pseudoFS[fstype] {
			continue
		}
		if seen[parts[0]] {
			continue
		}
		pct, used, total := mountUsage(mp)
		if total == 0 {
			continue
		}
		seen[parts[0]] = true
		if skipMounts[mp] {
			continue
		}
		rows = append(rows, struct {
			path  string
			pct   int
			used  float64
			total float64
		}{mp, pct, used, total})
	}
	return splitStorage(rows)
}

func splitStorage(rows []struct {
	path  string
	pct   int
	used  float64
	total float64
}) (model.StorageMount, []model.StorageMount) {
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].path == "/" {
			return true
		}
		if rows[j].path == "/" {
			return false
		}
		return rows[i].path < rows[j].path
	})
	var main model.StorageMount
	extras := []model.StorageMount{}
	colorIdx := 0
	for _, row := range rows {
		if row.path == "/" {
			main = model.StorageMount{Path: "/", Label: "/", Pct: row.pct, UsedGB: row.used, TotalGB: row.total, Color: mainDiskColor}
			continue
		}
		extras = append(extras, model.StorageMount{
			Path: row.path, Label: row.path, Pct: row.pct, UsedGB: row.used, TotalGB: row.total,
			Color: mountColors[colorIdx%len(mountColors)],
		})
		colorIdx++
	}
	if main.Path == "" {
		pct, used, total := mountUsage(hostPath("/"))
		main = model.StorageMount{Path: "/", Label: "/", Pct: pct, UsedGB: used, TotalGB: total, Color: mainDiskColor}
	}
	return main, extras
}

func mountUsage(mountpoint string) (pct int, usedGB, totalGB float64) {
	var st syscallStatfs
	if err := statfs(mountpoint, &st); err != nil {
		return 0, 0, 0
	}
	total := float64(st.Blocks) * float64(st.Bsize)
	free := float64(st.Bfree) * float64(st.Bsize)
	if total <= 0 {
		return 0, 0, 0
	}
	used := total - free
	pct = int((used / total) * 100)
	return pct, used / (1024 * 1024 * 1024), total / (1024 * 1024 * 1024)
}

// statfs wrapper — implemented in host_unix.go

func StorageAggregate(main model.StorageMount, extras []model.StorageMount) (pct int, usedGB, totalGB float64) {
	mounts := append([]model.StorageMount{main}, extras...)
	for _, m := range mounts {
		usedGB += m.UsedGB
		totalGB += m.TotalGB
	}
	if totalGB > 0 {
		pct = int((usedGB / totalGB) * 100)
	}
	return pct, usedGB, totalGB
}

func BuildMeters() []model.Meter {
	cpu, cores := CPUPercent()
	ramPct, ramUsed, ramTotal := RamStats()
	tempC, tempLabel := TemperatureStats()
	main, extras := StorageMounts()
	storagePct, storageUsed, storageTotal := StorageAggregate(main, extras)

	meters := []model.Meter{}
	meters = append(meters, model.Meter{
		"label": "CPU", "display": strconv.Itoa(cpu) + "%", "sub": strconv.Itoa(cores) + " cores",
		"showSub": true, "color": MeterColor(float64(cpu)), "barWidth": strconv.Itoa(cpu) + "%",
		"showBar": true, "showChart": true, "chartKey": "cpu", "pct": cpu,
		"showCaption": false, "caption": "", "detailKey": "cpu",
	})
	meters = append(meters, model.Meter{
		"label": "RAM", "display": strconv.Itoa(ramPct) + "%",
		"sub":     fmtGB(ramUsed) + " / " + strconv.FormatFloat(ramTotal, 'f', 0, 64) + " GB",
		"showSub": true, "color": MeterColor(float64(ramPct)), "barWidth": strconv.Itoa(ramPct) + "%",
		"showBar": true, "showChart": true, "chartKey": "ram", "pct": ramPct,
		"showCaption": false, "caption": "", "detailKey": "ram",
	})
	if tempC == nil {
		meters = append(meters, model.Meter{
			"label": "Temperatura", "display": "—", "sub": "indisponível", "showSub": true,
			"color": mutedFG, "barWidth": "0%", "showBar": false, "showCaption": false, "caption": "", "detailKey": "temp",
		})
	} else {
		tempPct := int(min(100, max(0, *tempC)))
		meters = append(meters, model.Meter{
			"label": "Temperatura", "display": strconv.Itoa(int(*tempC)) + "°C", "sub": tempLabel, "showSub": true,
			"color": TemperatureColor(*tempC), "barWidth": strconv.Itoa(tempPct) + "%", "showBar": true,
			"showChart": true, "chartKey": "temp", "pct": tempPct, "showCaption": false, "caption": "", "detailKey": "temp",
		})
	}
	meters = append(meters, model.Meter{
		"label": "Armazenamento", "type": "storage", "display": strconv.Itoa(storagePct) + "%",
		"sub":     fmtGB(storageUsed) + " / " + strconv.FormatFloat(storageTotal, 'f', 0, 64) + " GB",
		"showSub": true, "color": MeterColor(float64(storagePct)), "barWidth": strconv.Itoa(storagePct) + "%",
		"showBar": false, "showCaption": false, "caption": "", "main": main, "mounts": extras, "detailKey": "storage",
	})
	return meters
}

func fmtGB(v float64) string {
	return strconv.FormatFloat(v, 'f', 1, 64)
}

func FormatBytes(size float64) string {
	if size >= 1024*1024*1024 {
		return strconv.FormatFloat(size/(1024*1024*1024), 'f', 1, 64) + " GB"
	}
	if size >= 1024*1024 {
		return strconv.FormatFloat(size/(1024*1024), 'f', 1, 64) + " MB"
	}
	if size >= 1024 {
		return strconv.FormatFloat(size/1024, 'f', 1, 64) + " KB"
	}
	return strconv.FormatFloat(size, 'f', 0, 64) + " B"
}

func FormatPct(value float64) string {
	if value >= 10 {
		return strconv.FormatFloat(value, 'f', 0, 64) + "%"
	}
	if value >= 1 {
		return strconv.FormatFloat(value, 'f', 1, 64) + "%"
	}
	return strconv.FormatFloat(value, 'f', 2, 64) + "%"
}

func discoverMountpoints(hostRoot string) []string {
	mounts := []string{}
	// Só aceita pontos de montagem reais: o device difere do diretório pai (como na v2).
	// Sem isso, diretórios comuns como /media ou /srv entram como discos duplicados.
	add := func(p string) {
		if contains(mounts, p) {
			return
		}
		if fi, err := os.Stat(p); err != nil || !fi.IsDir() {
			return
		}
		dev, ok := deviceOf(p)
		parentDev, okParent := deviceOf(filepath.Dir(p))
		if !ok || !okParent {
			return
		}
		if dev != parentDev || p == hostRoot {
			mounts = append(mounts, p)
		}
	}
	add(hostRoot)
	fstab := filepath.Join(hostRoot, "etc", "fstab")
	if data, err := os.ReadFile(fstab); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.Fields(line)
			if len(parts) < 2 {
				continue
			}
			mp := parts[1]
			if mp == "/" {
				add(hostRoot)
			} else {
				add(filepath.Join(hostRoot, mp))
			}
		}
	}
	for _, parent := range []string{"mnt", "media", "srv"} {
		parentPath := filepath.Join(hostRoot, parent)
		if entries, err := os.ReadDir(parentPath); err == nil {
			add(parentPath)
			for _, e := range entries {
				add(filepath.Join(parentPath, e.Name()))
			}
		}
	}
	return mounts
}

func displayPath(mountPath, hostRoot string) string {
	if mountPath == hostRoot {
		return "/"
	}
	prefix := hostRoot + "/"
	if strings.HasPrefix(mountPath, prefix) {
		return mountPath[len(hostRoot):]
	}
	return mountPath
}

func contains(slice []string, s string) bool {
	for _, v := range slice {
		if v == s {
			return true
		}
	}
	return false
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func max(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
