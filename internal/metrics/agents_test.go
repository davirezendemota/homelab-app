package metrics

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/davi/homelab-app/internal/config"
	"github.com/davi/homelab-app/internal/model"
)

// stat no formato do kernel; campos não usados ficam em 0.
func fakeStat(pid, ppid int, comm string, utime, stime, start, rss int) string {
	f := make([]string, 50)
	for i := range f {
		f[i] = "0"
	}
	f[0] = "S"
	f[1] = strconv.Itoa(ppid)
	f[11] = strconv.Itoa(utime)
	f[12] = strconv.Itoa(stime)
	f[19] = strconv.Itoa(start)
	f[21] = strconv.Itoa(rss)
	return strconv.Itoa(pid) + " (" + comm + ") " + strings.Join(f, " ") + "\n"
}

func writeProc(t *testing.T, root string, pid, ppid int, comm, cmdline string, ticks, start, rss int) {
	t.Helper()
	dir := filepath.Join(root, "proc", strconv.Itoa(pid))
	writeFile(t, filepath.Join(dir, "stat"), fakeStat(pid, ppid, comm, ticks, 0, start, rss))
	writeFile(t, filepath.Join(dir, "cmdline"), strings.ReplaceAll(cmdline, " ", "\x00")+"\x00")
}

// Uma linha por agente; o agente iniciado por outro vira subagent logo abaixo do pai e
// sai da soma do pai.
func TestAgentSessionsGroupsProcessTree(t *testing.T) {
	root := t.TempDir()
	old := config.HostRoot
	config.HostRoot = root
	defer func() { config.HostRoot = old }()

	writeFile(t, filepath.Join(root, "proc/stat"), "cpu 1 2 3 4\nbtime 1700000000\n")
	writeProc(t, root, 100, 1, "zsh", "/usr/bin/zsh", 50, 10, 100)
	writeProc(t, root, 200, 100, "claude", "claude", 300, 20, 1000)
	writeProc(t, root, 201, 200, "bash", "/bin/bash -c ls", 10, 30, 200)
	writeProc(t, root, 202, 201, "claude", "claude -p sub", 5, 40, 300)
	writeProc(t, root, 203, 202, "rg", "rg foo", 1, 45, 50)
	writeProc(t, root, 300, 100, "MainThread", "/home/u/.local/bin/agent --use-system-ca /home/u/.local/share/cursor-agent/versions/x/index.js", 70, 15, 2000)
	writeProc(t, root, 400, 1, "node", "/home/u/.local/share/cursor-agent/versions/x/node /home/u/.local/share/cursor-agent/versions/x/index.js worker-server", 1, 60, 10)
	if err := os.Symlink("/home/davi/workspace/homelab-app", filepath.Join(root, "proc/200/cwd")); err != nil {
		t.Fatal(err)
	}

	r := NewAgentReader()
	got := r.Sessions()
	ids := []string{}
	for _, s := range got {
		ids = append(ids, s.ID+"<"+s.Parent)
	}
	// cursor-300 começou antes (start 15), mas o subagent fica colado no pai.
	if strings.Join(ids, " ") != "cursor-300< claude-200< claude-202<claude-200" {
		t.Fatalf("ordem/pais inesperados: %v", ids)
	}
	c, sub := got[1], got[2]
	page := uint64(os.Getpagesize())
	if c.Procs != 2 || c.MemBytes != 1200*page || c.Cwd != "~/workspace/homelab-app" {
		t.Fatalf("sessão pai deveria somar só 200+201: %+v", c)
	}
	if sub.Procs != 2 || sub.MemBytes != 350*page || sub.Label != "Claude Code" {
		t.Fatalf("subagent deveria somar 202+203: %+v", sub)
	}
	if got[0].Cwd != "" || c.CPUPct != 0 {
		t.Fatalf("sem cwd legível / primeira amostra com CPU 0: %+v %+v", got[0], c)
	}

	// Segunda amostra: +100 ticks na raiz do claude → CPU > 0.
	writeProc(t, root, 200, 100, "claude", "claude", 400, 20, 1000)
	got = r.Sessions()
	if got[1].CPUPct <= 0 {
		t.Fatalf("CPU deveria subir após delta de ticks: %+v", got[1])
	}
}

func TestAgentsMeterSub(t *testing.T) {
	m := AgentsMeter([]model.AgentSession{{ID: "a"}, {ID: "b", Parent: "a"}, {ID: "c"}})
	if sub, _ := m["sub"].(string); !strings.HasPrefix(sub, "2 sessões · 1 subagent · ") {
		t.Fatalf("sub = %q", sub)
	}
}
