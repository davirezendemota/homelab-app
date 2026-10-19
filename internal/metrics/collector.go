package metrics

import (
	"context"
	"log"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/davi/homelab-app/internal/config"
	"github.com/davi/homelab-app/internal/docker"
	"github.com/davi/homelab-app/internal/history"
	"github.com/davi/homelab-app/internal/hub"
	"github.com/davi/homelab-app/internal/model"
)

type Collector struct {
	client  *docker.Client
	history *history.Store
	hub     *hub.Hub

	mu           sync.RWMutex
	containers   []model.ContainerRow
	meters       []model.Meter
	statusErr    *string
	meterDetails map[string]map[string]interface{}
	lastStorage  time.Time
	state        string
	lastActivity time.Time
	lastHistory  []model.ContainerLifecycleEvent
	lastByHost   map[string]model.PagePayload

	cgroup *CgroupReader
	agents *AgentReader

	// Detalhe de armazenamento (GET /system/df): custa ~4 s de CPU ao dockerd por chamada,
	// então é calculado só quando o modal é aberto, com cache.
	storageMu sync.Mutex

	// refreshMu serializa refresh(): ticker, retomada após pausa, eventos e ações
	// podem pedir um refresh ao mesmo tempo.
	refreshMu sync.Mutex
	relistCh  chan struct{}
}

func NewCollector(client *docker.Client, hist *history.Store, h *hub.Hub) *Collector {
	return &Collector{
		client:       client,
		history:      hist,
		hub:          h,
		meterDetails: map[string]map[string]interface{}{},
		lastByHost:   map[string]model.PagePayload{},
		state:        "warming",
		lastActivity: time.Now(),
		cgroup:       NewCgroupReader(client),
		agents:       NewAgentReader(),
		relistCh:     make(chan struct{}, 1),
	}
}

func (c *Collector) TouchActivity() {
	c.mu.Lock()
	c.lastActivity = time.Now()
	if c.state == "paused" {
		c.state = "active"
		go c.tickNow()
	}
	c.mu.Unlock()
}

func (c *Collector) Start(ctx context.Context) {
	go c.loop(ctx)
	go c.watchEvents(ctx)
	go c.relistLoop(ctx)
}

// watchEvents mantém o stream /events do Docker aberto (em qualquer estado, custo ~0) e
// reconecta com backoff. Cada evento relevante atualiza o histórico e agenda um relist.
func (c *Collector) watchEvents(ctx context.Context) {
	backoff := time.Second
	for ctx.Err() == nil {
		connected := time.Now()
		err := c.client.StreamContainerEvents(ctx, func(ev docker.Event) {
			switch ev.Action {
			case "start", "restart", "die", "stop", "create", "destroy", "rename", "pause", "unpause":
			default:
				if !strings.HasPrefix(ev.Action, "health_status") {
					return
				}
			}
			c.history.OnDockerEvent(ev.Action, ev.Actor.ID, ev.Name(), ev.Stack())
			c.requestRelist()
		})
		if ctx.Err() != nil {
			return
		}
		if time.Since(connected) > 30*time.Second {
			backoff = time.Second
		}
		log.Printf("docker events: conexão perdida (%v); reconectando em %s", err, backoff)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		c.requestRelist()
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

func (c *Collector) requestRelist() {
	select {
	case c.relistCh <- struct{}{}:
	default:
	}
}

// relistLoop aplica os relists pedidos por eventos com debounce de 300 ms (um
// `docker compose up` gera dezenas de eventos em sequência).
func (c *Collector) relistLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.relistCh:
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(300 * time.Millisecond):
		}
		c.refresh(ctx)
	}
}

func (c *Collector) loop(ctx context.Context) {
	c.warm(ctx)
	ticker := time.NewTicker(time.Duration(config.CacheFastIntervalSec) * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.mu.RLock()
			state := c.state
			clients := c.hub.Clients()
			idle := time.Since(c.lastActivity) > time.Duration(config.CollectorIdlePauseSec)*time.Second
			c.mu.RUnlock()
			if clients == 0 && idle && state == "active" {
				c.mu.Lock()
				c.state = "paused"
				c.mu.Unlock()
				log.Println("collector: pausado (sem clientes)")
				continue
			}
			if state == "paused" {
				continue
			}
			c.refresh(ctx)
		}
	}
}

func (c *Collector) warm(ctx context.Context) {
	c.refresh(ctx)
	c.mu.Lock()
	c.state = "active"
	c.mu.Unlock()
}

func (c *Collector) tickNow() {
	c.refresh(context.Background())
}

func (c *Collector) Relist(ctx context.Context) {
	c.refresh(ctx)
}

func (c *Collector) refresh(ctx context.Context) {
	c.refreshMu.Lock()
	defer c.refreshMu.Unlock()

	var meterUpdates = map[string]map[string]interface{}{}
	cpuByName := map[string]float64{}
	memByName := map[string]float64{}
	var containers []model.ContainerRow
	var statusErr *string

	_, _, ramTotalGB := RamStats()
	ramTotalBytes := uint64(ramTotalGB * 1024 * 1024 * 1024)

	// Uma única chamada ao socket por ciclo: a listagem. CPU/memória vêm do cgroup.
	rows, fullIDs, listErr := c.client.ListContainers(ctx)
	if listErr != nil {
		s := listErr.Error()
		statusErr = &s
	}
	if pairs, err := c.cgroup.ContainerMetrics(rows, fullIDs); err == nil && len(pairs) > 0 {
		for name, m := range pairs {
			cpuByName[name] = m.CPUPct
			if ramTotalBytes > 0 {
				memByName[name] = (m.MemBytes / float64(ramTotalBytes)) * 100
			}
		}
		stackByName := make(map[string]string, len(rows))
		for _, r := range rows {
			stackByName[r.Name] = r.Stack
		}
		meterUpdates["cpu"], meterUpdates["ram"] = meterDetailFromPairs(pairs, stackByName, ramTotalBytes)
	} else if listErr == nil {
		// Fallback (cgroup indisponível: driver cgroupfs, rootless, outro host).
		if stats, err := c.client.RunningContainerStats(ctx); err == nil {
			for _, p := range stats {
				name := docker.ContainerName(p.Container)
				cpuByName[name] = docker.ContainerCPUPct(p.Stats)
				memByName[name] = docker.ContainerMemPctOfHost(p.Stats, ramTotalBytes)
			}
			meterUpdates["cpu"], meterUpdates["ram"] = meterDetailFromDockerStats(stats, ramTotalBytes)
		} else {
			msg := err.Error()
			meterUpdates["cpu"] = map[string]interface{}{"error": msg}
			meterUpdates["ram"] = map[string]interface{}{"error": msg}
		}
	}
	if listErr == nil {
		docker.AttachCPUPct(rows, cpuByName)
		docker.AttachMemPct(rows, memByName)
		containers = rows
		c.history.ObserveContainers(rows)
	}

	meters := withAgentsMeter(BuildMeters(), AgentsMeter(c.agents.Sessions()))
	meterUpdates["temp"] = map[string]interface{}{
		"rows":  TemperatureSensorDetails(),
		"total": 100,
	}

	c.mu.Lock()
	if containers != nil {
		c.containers = containers
	}
	c.meters = meters
	if statusErr != nil {
		c.statusErr = statusErr
	} else if containers != nil {
		c.statusErr = nil
	}
	for k, v := range meterUpdates {
		if _, hasErr := v["error"]; !hasErr || c.meterDetails[k] == nil {
			c.meterDetails[k] = v
		}
	}
	prev := c.lastHistory
	hist := c.history.Events()
	c.lastHistory = hist
	c.mu.Unlock()

	if histChanged(prev, hist) {
		c.hub.PublishHistory(hist)
	}
	hosts := c.hub.ActiveHosts()
	if len(hosts) == 0 && config.LinkHost != "" {
		hosts = []string{config.LinkHost}
	}
	for _, host := range hosts {
		c.publishHostIfChanged(host)
	}
}

func (c *Collector) publishHostIfChanged(host string) {
	payload := c.PagePayload(host)
	c.mu.Lock()
	prev, ok := c.lastByHost[host]
	changed := !ok || StatusPayloadChanged(prev, payload)
	if changed {
		c.lastByHost[host] = payload
	}
	c.mu.Unlock()
	if changed {
		c.hub.PublishStatus(host, payload)
	}
}

func (c *Collector) PagePayload(host string) model.PagePayload {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return model.PagePayload{
		Host:             host,
		Build:            config.ModuleBuild,
		LoadedBuild:      config.ModuleBuild,
		Error:            c.statusErr,
		Containers:       cloneContainers(c.containers),
		Meters:           cloneMeters(c.meters),
		ContainerHistory: append([]model.ContainerLifecycleEvent{}, c.history.Events()...),
	}
}

// StorageDetail devolve o detalhe de armazenamento, recalculando no máximo a cada
// CacheStorageIntervalSec. storageMu garante uma única chamada a /system/df por vez.
func (c *Collector) StorageDetail(ctx context.Context) map[string]interface{} {
	c.storageMu.Lock()
	defer c.storageMu.Unlock()
	c.mu.RLock()
	fresh := c.meterDetails["storage"] != nil && time.Since(c.lastStorage) < time.Duration(config.CacheStorageIntervalSec)*time.Second
	c.mu.RUnlock()
	if !fresh {
		detail, err := MeterDetailStorage(ctx, c.client)
		c.mu.Lock()
		if err == nil {
			c.meterDetails["storage"] = detail
			c.lastStorage = time.Now()
		} else if c.meterDetails["storage"] == nil {
			c.mu.Unlock()
			return map[string]interface{}{"kind": "storage", "error": err.Error()}
		}
		c.mu.Unlock()
	}
	return c.MeterDetail("storage")
}

func (c *Collector) MeterDetail(kind string) map[string]interface{} {
	c.mu.RLock()
	data := c.meterDetails[kind]
	c.mu.RUnlock()
	if data == nil {
		return map[string]interface{}{"kind": kind, "error": "Dados ainda não disponíveis"}
	}
	out := map[string]interface{}{}
	for k, v := range data {
		out[k] = v
	}
	out["kind"] = kind
	return out
}

func histChanged(a, b []model.ContainerLifecycleEvent) bool {
	if len(a) != len(b) {
		return true
	}
	for i := range a {
		if a[i].At != b[i].At || a[i].Name != b[i].Name || a[i].Kind != b[i].Kind {
			return true
		}
	}
	return false
}

func cloneContainers(in []model.ContainerRow) []model.ContainerRow {
	out := make([]model.ContainerRow, len(in))
	copy(out, in)
	return out
}

func cloneMeters(in []model.Meter) []model.Meter {
	out := make([]model.Meter, len(in))
	copy(out, in)
	return out
}

func StatusPayloadChanged(a, b model.PagePayload) bool {
	if a.Error == nil && b.Error != nil || a.Error != nil && b.Error == nil {
		return true
	}
	if a.Error != nil && b.Error != nil && *a.Error != *b.Error {
		return true
	}
	if len(a.Containers) != len(b.Containers) {
		return true
	}
	for i := range a.Containers {
		ac, bc := a.Containers[i], b.Containers[i]
		if ac.ID != bc.ID || ac.Name != bc.Name || ac.Status != bc.Status || ac.Image != bc.Image ||
			ac.Stack != bc.Stack || !portsEqual(ac.Ports, bc.Ports) || !healthEqual(ac.Health, bc.Health) {
			return true
		}
		if !pctEqual(ac.CPUPct, bc.CPUPct) || !pctEqual(ac.MemPct, bc.MemPct) {
			return true
		}
	}
	if len(a.Meters) != len(b.Meters) {
		return true
	}
	for i := range a.Meters {
		if meterChanged(a.Meters[i], b.Meters[i]) {
			return true
		}
	}
	return false
}

func portsEqual(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func healthEqual(a, b *string) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

func pctEqual(a, b *float64) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return math.Round(*a*10) == math.Round(*b*10)
}

func meterChanged(a, b model.Meter) bool {
	for _, k := range []string{"display", "barWidth", "color", "sub"} {
		if a[k] != b[k] {
			return true
		}
	}
	if as, ok := a["sessions"].([]model.AgentSession); ok {
		bs, _ := b["sessions"].([]model.AgentSession)
		if !sessionsEqual(as, bs) {
			return true
		}
	}
	if ap, ok := a["pct"].(int); ok {
		if bp, ok2 := b["pct"].(int); ok2 && ap != bp {
			return true
		}
	}
	return false
}

func sessionsEqual(a, b []model.AgentSession) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		x, y := a[i], b[i]
		if x.ID != y.ID || x.CPUDisplay != y.CPUDisplay || x.MemDisplay != y.MemDisplay || x.Uptime != y.Uptime || x.Parent != y.Parent || x.Cwd != y.Cwd {
			return false
		}
	}
	return true
}

// withAgentsMeter insere o card de sessões logo depois do de Temperatura.
func withAgentsMeter(meters []model.Meter, agents model.Meter) []model.Meter {
	out := make([]model.Meter, 0, len(meters)+1)
	inserted := false
	for _, m := range meters {
		out = append(out, m)
		if m["detailKey"] == "temp" {
			out = append(out, agents)
			inserted = true
		}
	}
	if !inserted {
		out = append(out, agents)
	}
	return out
}
