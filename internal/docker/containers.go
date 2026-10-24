package docker

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"sync"

	"github.com/davi/homelab-app/internal/config"
	"github.com/davi/homelab-app/internal/model"
)

type ListItem struct {
	ID     string            `json:"Id"`
	Names  []string          `json:"Names"`
	Image  string            `json:"Image"`
	Status string            `json:"Status"`
	Ports  []dockerPort      `json:"Ports"`
	Labels map[string]string `json:"Labels"`
}

type dockerPort struct {
	PublicPort int    `json:"PublicPort"`
	Type       string `json:"Type"`
}

type ContainerStats struct {
	CPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
		OnlineCPUs     uint32 `json:"online_cpus"`
	} `json:"cpu_stats"`
	PreCPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
	} `json:"precpu_stats"`
	MemoryStats struct {
		Usage uint64 `json:"usage"`
	} `json:"memory_stats"`
}

func PublishedPorts(ports []dockerPort) []int {
	out := []int{}
	seen := map[int]bool{}
	for _, p := range ports {
		if p.PublicPort == 0 || strings.ToLower(p.Type) != "tcp" {
			continue
		}
		if seen[p.PublicPort] {
			continue
		}
		seen[p.PublicPort] = true
		out = append(out, p.PublicPort)
	}
	sort.Ints(out)
	return out
}

func ParseHealth(status string) *string {
	s := strings.ToLower(status)
	for _, h := range []string{"healthy", "unhealthy", "starting"} {
		if strings.Contains(s, "("+h+")") {
			return &h
		}
	}
	return nil
}

func ContainerName(c ListItem) string {
	names := make([]string, 0, len(c.Names))
	for _, n := range c.Names {
		names = append(names, strings.TrimPrefix(n, "/"))
	}
	id := c.ID
	if len(names) > 0 {
		return names[0]
	}
	if len(id) >= 12 {
		return id[:12]
	}
	return id
}

func IsContainerRunning(status string) bool {
	return strings.HasPrefix(strings.ToLower(status), "up")
}

// ListContainers faz uma única chamada a /containers/json?all=1 e devolve as linhas
// (id curto) e o mapa nome → id completo, usado para achar o cgroup de cada container.
func (c *Client) ListContainers(ctx context.Context) ([]model.ContainerRow, map[string]string, error) {
	var list []ListItem
	if err := c.GetJSON(ctx, "/containers/json?all=1", &list); err != nil {
		return nil, nil, err
	}
	rows := make([]model.ContainerRow, 0, len(list))
	fullIDs := make(map[string]string, len(list))
	for _, item := range list {
		status := item.Status
		cid := strings.TrimSpace(item.ID)
		shortID := cid
		if len(shortID) > 12 {
			shortID = shortID[:12]
		}
		name := ContainerName(item)
		fullIDs[name] = cid
		stack := StackFromLabels(item.Labels)
		rows = append(rows, model.ContainerRow{
			ID:        shortID,
			Name:      name,
			Image:     item.Image,
			Status:    status,
			Ports:     PublishedPorts(item.Ports),
			Stack:     stack.Name,
			StackKind: stack.Kind,
			Health:    ParseHealth(status),
		})
	}
	sort.Slice(rows, func(i, j int) bool {
		sa := strings.ToLower(rows[i].Stack)
		sb := strings.ToLower(rows[j].Stack)
		if sa != sb {
			return sa < sb
		}
		return strings.ToLower(rows[i].Name) < strings.ToLower(rows[j].Name)
	})
	return rows, fullIDs, nil
}

func (c *Client) RunningContainers(ctx context.Context) ([]model.ContainerRow, error) {
	rows, _, err := c.ListContainers(ctx)
	return rows, err
}

func (c *Client) ContainersInStack(ctx context.Context, stack string) ([]model.ContainerRow, error) {
	if err := ValidateStackName(stack); err != nil {
		return nil, err
	}
	all, err := c.RunningContainers(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]model.ContainerRow, 0)
	for _, row := range all {
		if row.Stack == stack {
			out = append(out, row)
		}
	}
	return out, nil
}

func ContainerCPUPct(stats ContainerStats) float64 {
	cpu := stats.CPUStats
	precpu := stats.PreCPUStats
	cpuUsage := cpu.CPUUsage.TotalUsage
	preCPU := precpu.CPUUsage.TotalUsage
	sys := cpu.SystemCPUUsage
	preSys := precpu.SystemCPUUsage
	if sys == 0 || preSys == 0 {
		return 0
	}
	cpuDelta := float64(cpuUsage - preCPU)
	sysDelta := float64(sys - preSys)
	if sysDelta <= 0 || cpuDelta < 0 {
		return 0
	}
	online := float64(cpu.OnlineCPUs)
	if online == 0 {
		online = 1
	}
	return (cpuDelta / sysDelta) * online * 100
}

func ContainerMemoryBytes(stats ContainerStats) uint64 {
	u := stats.MemoryStats.Usage
	if u > 0 {
		return u
	}
	return 0
}

type StatsPair struct {
	Container ListItem
	Stats     ContainerStats
}

func (c *Client) RunningContainerStats(ctx context.Context) ([]StatsPair, error) {
	var containers []ListItem
	if err := c.GetJSON(ctx, "/containers/json", &containers); err != nil {
		return nil, err
	}
	out := make([]StatsPair, 0, len(containers))
	var mu sync.Mutex
	runParallel(ctx, containers, 8, func(item ListItem) {
		id := item.ID
		if id == "" {
			return
		}
		quoted := url.PathEscape(id)
		body, err := c.Get(ctx, "/containers/"+quoted+"/stats?stream=false")
		if err != nil {
			return
		}
		var stats ContainerStats
		if json.Unmarshal(body, &stats) != nil {
			return
		}
		mu.Lock()
		out = append(out, StatsPair{Container: item, Stats: stats})
		mu.Unlock()
	})
	return out, nil
}

func runParallel[T any](ctx context.Context, items []T, workers int, fn func(T)) {
	if len(items) == 0 {
		return
	}
	if len(items) == 1 {
		fn(items[0])
		return
	}
	if workers > len(items) {
		workers = len(items)
	}
	idx := 0
	var mu sync.Mutex
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				mu.Lock()
				if idx >= len(items) {
					mu.Unlock()
					return
				}
				i := idx
				idx++
				mu.Unlock()
				fn(items[i])
			}
		}()
	}
	wg.Wait()
}

func AttachCPUPct(rows []model.ContainerRow, byName map[string]float64) {
	for i := range rows {
		if IsContainerRunning(rows[i].Status) {
			v := byName[rows[i].Name]
			rows[i].CPUPct = &v
		} else {
			rows[i].CPUPct = nil
		}
	}
}

func ContainerMemPctOfHost(stats ContainerStats, hostRamTotalBytes uint64) float64 {
	if hostRamTotalBytes <= 0 {
		return 0
	}
	return (float64(ContainerMemoryBytes(stats)) / float64(hostRamTotalBytes)) * 100
}

func AttachMemPct(rows []model.ContainerRow, byName map[string]float64) {
	for i := range rows {
		if IsContainerRunning(rows[i].Status) {
			v := byName[rows[i].Name]
			rows[i].MemPct = &v
		} else {
			rows[i].MemPct = nil
		}
	}
}

func (c *Client) ContainerStart(ctx context.Context, ref string) error {
	quoted, err := ValidateContainerRef(ref)
	if err != nil {
		return err
	}
	return c.Request(ctx, "POST", "/containers/"+quoted+"/start", nil)
}

func (c *Client) ContainerStop(ctx context.Context, ref string) error {
	quoted, err := ValidateContainerRef(ref)
	if err != nil {
		return err
	}
	return c.Request(ctx, "POST", "/containers/"+quoted+"/stop?t=30", nil)
}

func (c *Client) ContainerRestart(ctx context.Context, ref string) error {
	quoted, err := ValidateContainerRef(ref)
	if err != nil {
		return err
	}
	return c.Request(ctx, "POST", "/containers/"+quoted+"/restart?t=30", nil)
}

func (c *Client) ContainerRemove(ctx context.Context, ref string, force bool) error {
	quoted, err := ValidateContainerRef(ref)
	if err != nil {
		return err
	}
	suffix := ""
	if force {
		suffix = "?force=true"
	}
	return c.Request(ctx, "DELETE", "/containers/"+quoted+suffix, nil)
}

func (c *Client) StackStop(ctx context.Context, stack string) error {
	targets, err := c.ContainersInStack(ctx, stack)
	if err != nil {
		return err
	}
	running := make([]model.ContainerRow, 0)
	for _, t := range targets {
		if IsContainerRunning(t.Status) {
			running = append(running, t)
		}
	}
	return c.runOnContainers(ctx, running, func(row model.ContainerRow) error {
		return c.ContainerStop(ctx, row.ID)
	})
}

func (c *Client) StackRestart(ctx context.Context, stack string) error {
	targets, err := c.ContainersInStack(ctx, stack)
	if err != nil {
		return err
	}
	return c.runOnContainers(ctx, targets, func(row model.ContainerRow) error {
		return c.ContainerRestart(ctx, row.ID)
	})
}

func (c *Client) StackRemove(ctx context.Context, stack string) error {
	targets, err := c.ContainersInStack(ctx, stack)
	if err != nil {
		return err
	}
	return c.runOnContainers(ctx, targets, func(row model.ContainerRow) error {
		return c.ContainerRemove(ctx, row.ID, true)
	})
}

func (c *Client) runOnContainers(ctx context.Context, rows []model.ContainerRow, fn func(model.ContainerRow) error) error {
	var firstErr error
	var mu sync.Mutex
	runParallel(ctx, rows, 8, func(row model.ContainerRow) {
		if err := fn(row); err != nil {
			mu.Lock()
			if firstErr == nil {
				firstErr = err
			}
			mu.Unlock()
		}
	})
	return firstErr
}

func (c *Client) ContainerHasTTY(ctx context.Context, ref string) (bool, error) {
	quoted, err := ValidateContainerRef(ref)
	if err != nil {
		return false, err
	}
	var info struct {
		Config struct {
			Tty bool `json:"Tty"`
		} `json:"Config"`
	}
	if err := c.GetJSON(ctx, "/containers/"+quoted+"/json", &info); err != nil {
		return false, err
	}
	return info.Config.Tty, nil
}

func (c *Client) OpenContainerLogsPath(ref string) (string, error) {
	quoted, err := ValidateContainerRef(ref)
	if err != nil {
		return "", err
	}
	q := url.Values{}
	q.Set("stdout", "1")
	q.Set("stderr", "1")
	q.Set("follow", "1")
	q.Set("tail", fmt.Sprintf("%d", config.LogTail))
	q.Set("timestamps", "0")
	return "/containers/" + quoted + "/logs?" + q.Encode(), nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
