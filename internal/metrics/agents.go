package metrics

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/davi/homelab-app/internal/config"
	"github.com/davi/homelab-app/internal/model"
)

// clockTicks é o USER_HZ do kernel (100 em todas as arquiteturas suportadas).
const clockTicks = 100

// AgentReader encontra as sessões de agentes de código (Claude Code, Cursor Agent) no
// /proc do host. Cada processo de agente é uma linha; CPU e RAM somam a árvore dele
// (shells, ferramentas, servidores MCP) até outro agente. Um agente iniciado por outro
// (ex.: `claude -p` rodado por uma sessão) é um subagent e vem logo abaixo do pai.
type AgentReader struct {
	mu   sync.Mutex
	prev map[procKey]uint64 // ticks de CPU por processo na amostra anterior
	at   time.Time
}

type procKey struct {
	pid   int
	start uint64 // starttime: distingue um PID reutilizado
}

type procStat struct {
	pid, ppid int
	ticks     uint64 // utime + stime
	start     uint64
	rssPages  uint64
}

func NewAgentReader() *AgentReader {
	return &AgentReader{prev: map[procKey]uint64{}}
}

func procRoot() string {
	if usingHostStorage() {
		return filepath.Join(config.HostRoot, "proc")
	}
	return "/proc"
}

// Sessions lê o /proc uma vez e devolve as sessões ordenadas por início (mais antiga
// primeiro), para a ordem das linhas não pular a cada ciclo.
func (r *AgentReader) Sessions() []model.AgentSession {
	root := procRoot()
	entries, err := os.ReadDir(root)
	if err != nil {
		return []model.AgentSession{}
	}
	procs := map[int]procStat{}
	children := map[int][]int{}
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		st, ok := readProcStat(root, pid)
		if !ok {
			continue
		}
		procs[pid] = st
		children[st.ppid] = append(children[st.ppid], pid)
	}

	kinds := map[int]string{}
	for pid := range procs {
		if kind := agentKind(readCmdline(root, pid)); kind != "" {
			kinds[pid] = kind
		}
	}

	now := time.Now()
	r.mu.Lock()
	defer r.mu.Unlock()
	first := r.at.IsZero()
	elapsed := now.Sub(r.at).Seconds()
	next := map[procKey]uint64{}
	bootSec := bootTime(root)
	pageSize := uint64(os.Getpagesize())

	sessions := []model.AgentSession{}
	for pid, kind := range kinds {
		var ticks uint64
		var rss uint64
		count := 0
		stack := []int{pid}
		for len(stack) > 0 {
			p := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			st := procs[p]
			key := procKey{pid: p, start: st.start}
			next[key] = st.ticks
			// Processo novo desde a amostra anterior: todo o tempo dele cabe no intervalo.
			if prev, ok := r.prev[key]; ok {
				if st.ticks >= prev {
					ticks += st.ticks - prev
				}
			} else {
				ticks += st.ticks
			}
			rss += st.rssPages * pageSize
			count++
			for _, c := range children[p] {
				if _, sub := kinds[c]; !sub {
					stack = append(stack, c)
				}
			}
		}
		cpu := 0.0
		if !first && elapsed > 0 {
			cpu = float64(ticks) / clockTicks / elapsed * 100
		}
		st := procs[pid]
		var started int64
		if bootSec > 0 {
			started = (bootSec*clockTicks + int64(st.start)) * 1000 / clockTicks
		}
		parent := ""
		if pp := agentAncestor(pid, procs, kinds); pp != 0 {
			parent = kinds[pp] + "-" + strconv.Itoa(pp)
		}
		sessions = append(sessions, model.AgentSession{
			ID:         kind + "-" + strconv.Itoa(pid),
			Parent:     parent,
			Kind:       kind,
			Label:      agentLabels[kind],
			PID:        pid,
			Cwd:        readCwd(root, pid),
			StartedAt:  started,
			Uptime:     fmtUptime(now.UnixMilli() - started),
			Procs:      count,
			CPUPct:     cpu,
			CPUDisplay: FormatPct(cpu),
			MemBytes:   rss,
			MemDisplay: FormatBytes(float64(rss)),
			Color:      MeterColor(cpu),
		})
	}
	r.prev = next
	r.at = now

	sort.Slice(sessions, func(i, j int) bool {
		if sessions[i].StartedAt != sessions[j].StartedAt {
			return sessions[i].StartedAt < sessions[j].StartedAt
		}
		return sessions[i].PID < sessions[j].PID
	})
	return nestSubagents(sessions)
}

// nestSubagents põe cada subagent logo abaixo do pai, mantendo a ordem por início.
func nestSubagents(sessions []model.AgentSession) []model.AgentSession {
	byParent := map[string][]model.AgentSession{}
	for _, s := range sessions {
		byParent[s.Parent] = append(byParent[s.Parent], s)
	}
	out := make([]model.AgentSession, 0, len(sessions))
	var add func(id string)
	add = func(id string) {
		for _, s := range byParent[id] {
			out = append(out, s)
			add(s.ID)
		}
	}
	add("")
	return out
}

var agentLabels = map[string]string{"claude": "Claude Code", "cursor": "Cursor Agent"}

// agentKind identifica o agente pela linha de comando: o binário `claude` (ou o
// cli.js do pacote npm) e o index.js do cursor-agent (exceto o worker-server).
func agentKind(argv []string) string {
	if len(argv) == 0 {
		return ""
	}
	if filepath.Base(argv[0]) == "claude" {
		return "claude"
	}
	cmd := strings.Join(argv, " ")
	if strings.Contains(cmd, "@anthropic-ai/claude-code/cli.js") {
		return "claude"
	}
	if strings.Contains(cmd, "/cursor-agent/") && !strings.Contains(cmd, "worker-server") {
		return "cursor"
	}
	return ""
}

// agentAncestor devolve o PID do agente mais próximo acima de pid (0 se não houver).
func agentAncestor(pid int, procs map[int]procStat, kinds map[int]string) int {
	seen := map[int]bool{pid: true}
	for p := procs[pid].ppid; p > 1 && !seen[p]; p = procs[p].ppid {
		if _, ok := kinds[p]; ok {
			return p
		}
		if _, ok := procs[p]; !ok {
			return 0
		}
		seen[p] = true
	}
	return 0
}

// readCwd devolve a pasta da sessão, com a home abreviada para "~". Ler o link exige
// o mesmo uid do processo e um perfil AppArmor que permita ptrace de leitura
// (ver infra/compose.local.yaml); sem isso volta vazio.
func readCwd(root string, pid int) string {
	p, err := os.Readlink(filepath.Join(root, strconv.Itoa(pid), "cwd"))
	if err == nil && p != "" {
		return homeRe.ReplaceAllString(p, "~$2")
	}
	return readCwdFromEnviron(root, pid)
}

func readCwdFromEnviron(root string, pid int) string {
	b, err := os.ReadFile(filepath.Join(root, strconv.Itoa(pid), "environ"))
	if err != nil {
		return ""
	}
	for _, part := range strings.Split(string(b), "\x00") {
		if strings.HasPrefix(part, "PWD=") {
			p := strings.TrimPrefix(part, "PWD=")
			if p != "" {
				return homeRe.ReplaceAllString(p, "~$2")
			}
		}
	}
	return ""
}

var homeRe = regexp.MustCompile(`^(/home/[^/]+|/root)(/|$)`)

func readCmdline(root string, pid int) []string {
	b, err := os.ReadFile(filepath.Join(root, strconv.Itoa(pid), "cmdline"))
	if err != nil || len(b) == 0 {
		return nil
	}
	return strings.Split(strings.TrimRight(string(b), "\x00"), "\x00")
}

// readProcStat lê /proc/<pid>/stat. O comm vem entre parênteses e pode conter espaços,
// então os campos são contados a partir do último ')'.
func readProcStat(root string, pid int) (procStat, bool) {
	b, err := os.ReadFile(filepath.Join(root, strconv.Itoa(pid), "stat"))
	if err != nil {
		return procStat{}, false
	}
	s := string(b)
	end := strings.LastIndexByte(s, ')')
	if end < 0 {
		return procStat{}, false
	}
	f := strings.Fields(s[end+1:])
	// f[0] = state (campo 3); campo N do stat = f[N-3].
	if len(f) < 22 {
		return procStat{}, false
	}
	num := func(i int) uint64 {
		v, _ := strconv.ParseUint(f[i], 10, 64)
		return v
	}
	ppid, _ := strconv.Atoi(f[1])
	return procStat{
		pid:      pid,
		ppid:     ppid,
		ticks:    num(11) + num(12),
		start:    num(19),
		rssPages: num(21),
	}, true
}

func bootTime(root string) int64 {
	b, err := os.ReadFile(filepath.Join(root, "stat"))
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(b), "\n") {
		if v, ok := strings.CutPrefix(line, "btime "); ok {
			n, _ := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
			return n
		}
	}
	return 0
}

func fmtUptime(ms int64) string {
	m := ms / 60_000
	switch {
	case m < 1:
		return "agora"
	case m < 60:
		return strconv.FormatInt(m, 10) + " min"
	case m < 24*60:
		return strconv.FormatInt(m/60, 10) + " h " + strconv.FormatInt(m%60, 10) + " min"
	default:
		return strconv.FormatInt(m/(24*60), 10) + " d " + strconv.FormatInt(m%(24*60)/60, 10) + " h"
	}
}

// AgentsMeter monta o card "Agent Sessions" a partir das sessões.
func AgentsMeter(sessions []model.AgentSession) model.Meter {
	var mem uint64
	subs := 0
	for _, s := range sessions {
		mem += s.MemBytes
		if s.Parent != "" {
			subs++
		}
	}
	sub := "nenhuma"
	if n := len(sessions) - subs; n > 0 {
		sub = plural(n, "sessão", "sessões")
		if subs > 0 {
			sub += " · " + plural(subs, "subagent", "subagents")
		}
		sub += " · " + FormatBytes(float64(mem))
	}
	return model.Meter{
		"label": "Agent Sessions", "type": "agents", "display": strconv.Itoa(len(sessions)), "sub": sub,
		"showSub": true, "color": mutedFG, "barWidth": "0%", "showBar": false, "showCaption": false, "caption": "",
		"sessions": sessions,
	}
}

func plural(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return strconv.Itoa(n) + " " + many
}
