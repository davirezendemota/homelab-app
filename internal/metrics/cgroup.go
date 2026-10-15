package metrics

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/davi/homelab-app/internal/config"
	"github.com/davi/homelab-app/internal/docker"
	"github.com/davi/homelab-app/internal/model"
)

type ContainerMetric struct {
	CPUPct   float64
	MemBytes float64
}

type CgroupReader struct {
	client   *docker.Client
	mu       sync.Mutex
	prevCPU  map[string]cpuUsageSample
	paths    map[string]string
	fallback map[string]bool
}

type cpuUsageSample struct {
	usageUsec uint64
	at        time.Time
}

func NewCgroupReader(client *docker.Client) *CgroupReader {
	return &CgroupReader{
		client:   client,
		prevCPU:  map[string]cpuUsageSample{},
		paths:    map[string]string{},
		fallback: map[string]bool{},
	}
}

// ContainerMetrics lê CPU e memória dos containers em execução direto do cgroup v2,
// sem nenhuma chamada ao socket do Docker. fullIDs vem da mesma listagem do ciclo.
func (r *CgroupReader) ContainerMetrics(rows []model.ContainerRow, fullIDs map[string]string) (map[string]ContainerMetric, error) {
	out := map[string]ContainerMetric{}
	alive := map[string]bool{}
	for _, row := range rows {
		if !docker.IsContainerRunning(row.Status) {
			continue
		}
		alive[row.Name] = true
		fullID := fullIDs[row.Name]
		if fullID == "" {
			fullID = row.ID
		}
		if m, ok := r.readCgroup(row.Name, fullID); ok {
			out[row.Name] = m
		}
	}
	r.mu.Lock()
	for name := range r.prevCPU {
		if !alive[name] {
			delete(r.prevCPU, name)
		}
	}
	r.mu.Unlock()
	if len(out) == 0 {
		return nil, os.ErrNotExist
	}
	return out, nil
}

func (r *CgroupReader) readCgroup(name, fullID string) (ContainerMetric, bool) {
	path := r.findCgroupPath(fullID)
	if path == "" {
		return ContainerMetric{}, false
	}
	usageUsec, err := readCPUUsage(filepath.Join(path, "cpu.stat"))
	if err != nil {
		r.forgetPath(fullID)
		return ContainerMetric{}, false
	}
	memBytes, err := readMemory(filepath.Join(path, "memory.current"), filepath.Join(path, "memory.stat"))
	if err != nil {
		return ContainerMetric{}, false
	}

	r.mu.Lock()
	prev := r.prevCPU[name]
	now := time.Now()
	var cpuPct float64
	if !prev.at.IsZero() {
		dt := now.Sub(prev.at).Microseconds()
		if dt > 0 && usageUsec >= prev.usageUsec {
			cpuPct = float64(usageUsec-prev.usageUsec) / float64(dt) * 100
		}
	}
	r.prevCPU[name] = cpuUsageSample{usageUsec: usageUsec, at: now}
	r.mu.Unlock()

	return ContainerMetric{CPUPct: cpuPct, MemBytes: memBytes}, true
}

func (r *CgroupReader) forgetPath(fullID string) {
	r.mu.Lock()
	delete(r.paths, fullID)
	r.mu.Unlock()
}

func (r *CgroupReader) findCgroupPath(fullID string) string {
	r.mu.Lock()
	p, ok := r.paths[fullID]
	r.mu.Unlock()
	if ok {
		return p
	}
	candidates := []string{
		filepath.Join(config.HostRoot, "sys/fs/cgroup/system.slice", "docker-"+fullID+".scope"),
		filepath.Join(config.HostRoot, "sys/fs/cgroup/docker", fullID),
		filepath.Join("/sys/fs/cgroup/system.slice", "docker-"+fullID+".scope"),
		filepath.Join("/sys/fs/cgroup/docker", fullID),
	}
	for _, c := range candidates {
		if dirExists(c) {
			r.mu.Lock()
			r.paths[fullID] = c
			r.mu.Unlock()
			return c
		}
	}
	return ""
}

func readCPUUsage(path string) (uint64, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "usage_usec ") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				return strconv.ParseUint(fields[1], 10, 64)
			}
		}
	}
	return 0, os.ErrNotExist
}

func readMemory(currentPath, statPath string) (float64, error) {
	curB, err := os.ReadFile(currentPath)
	if err != nil {
		return 0, err
	}
	current, err := strconv.ParseUint(strings.TrimSpace(string(curB)), 10, 64)
	if err != nil {
		return 0, err
	}
	inactive := uint64(0)
	if statB, err := os.ReadFile(statPath); err == nil {
		for _, line := range strings.Split(string(statB), "\n") {
			if strings.HasPrefix(line, "inactive_file ") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					inactive, _ = strconv.ParseUint(fields[1], 10, 64)
				}
			}
		}
	}
	if current > inactive {
		current -= inactive
	}
	return float64(current), nil
}
