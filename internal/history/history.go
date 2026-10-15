package history

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/davi/homelab-app/internal/config"
	"github.com/davi/homelab-app/internal/docker"
	"github.com/davi/homelab-app/internal/model"
)

type Store struct {
	mu           sync.Mutex
	events       []model.ContainerLifecycleEvent
	watch        map[string]watchState
	bootstrapped bool
}

type watchState struct {
	id        string
	startedAt string
	running   bool
}

func New() *Store {
	return &Store{watch: map[string]watchState{}}
}

func (s *Store) Events() []model.ContainerLifecycleEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]model.ContainerLifecycleEvent, len(s.events))
	copy(out, s.events)
	return out
}

func (s *Store) Record(name, stack, kind string) {
	if name == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	ev := model.ContainerLifecycleEvent{
		At:    time.Now().UnixMilli(),
		Name:  name,
		Stack: stack,
		Kind:  kind,
	}
	s.push(ev)
	prev := s.watch[name]
	s.watch[name] = watchState{id: prev.id, startedAt: prev.startedAt, running: true}
}

func (s *Store) push(ev model.ContainerLifecycleEvent) {
	// Uma ação gera vários registros quase simultâneos (evento start/restart do Docker,
	// registro feito pela própria API, polling). Dentro da janela, o mesmo container
	// conta uma vez só; "restarted" tem precedência sobre "started".
	if len(s.events) > 0 {
		last := s.events[0]
		if last.Name == ev.Name && ev.At-last.At < int64(config.HistoryDedupeMS) {
			if ev.Kind == "restarted" && last.Kind == "started" {
				s.events[0].Kind = "restarted"
			}
			return
		}
	}
	s.events = append([]model.ContainerLifecycleEvent{ev}, s.events...)
	if len(s.events) > config.HistoryMax {
		s.events = s.events[:config.HistoryMax]
	}
}

func (s *Store) ObserveContainers(containers []model.ContainerRow) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.bootstrapped {
		for _, c := range containers {
			s.watch[c.Name] = watchState{
				id:      c.ID,
				running: docker.IsContainerRunning(c.Status),
			}
		}
		s.bootstrapped = true
		return
	}
	for _, c := range containers {
		running := docker.IsContainerRunning(c.Status)
		prev := s.watch[c.Name]
		if running {
			if !prev.running {
				kind := "started"
				if prev.id != "" {
					kind = "restarted"
				}
				s.push(model.ContainerLifecycleEvent{
					At: time.Now().UnixMilli(), Name: c.Name, Stack: c.Stack, Kind: kind,
				})
			} else if prev.id != "" && prev.id != c.ID {
				s.push(model.ContainerLifecycleEvent{
					At: time.Now().UnixMilli(), Name: c.Name, Stack: c.Stack, Kind: "started",
				})
			}
		}
		s.watch[c.Name] = watchState{id: c.ID, startedAt: prev.startedAt, running: running}
	}
}

// OnDockerEvent registra start/restart vindos de GET /events e mantém o estado observado
// (id e running) em dia, para que ObserveContainers não registre o mesmo start de novo.
func (s *Store) OnDockerEvent(action, fullID, name, stack string) {
	if name == "" {
		return
	}
	id := fullID
	if len(id) > 12 {
		id = id[:12]
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	prev := s.watch[name]
	switch strings.ToLower(action) {
	case "start":
		kind := "started"
		if prev.id != "" {
			kind = "restarted"
		}
		s.push(model.ContainerLifecycleEvent{At: time.Now().UnixMilli(), Name: name, Stack: stack, Kind: kind})
		s.watch[name] = watchState{id: id, startedAt: prev.startedAt, running: true}
	case "restart":
		s.push(model.ContainerLifecycleEvent{At: time.Now().UnixMilli(), Name: name, Stack: stack, Kind: "restarted"})
		s.watch[name] = watchState{id: id, startedAt: prev.startedAt, running: true}
	case "die", "stop":
		if prev.id != "" || prev.running {
			s.watch[name] = watchState{id: prev.id, startedAt: prev.startedAt, running: false}
		}
	}
}

func (s *Store) RecordFromRef(ctx context.Context, client *docker.Client, ref, kind string) {
	identity, err := client.ContainerIdentity(ctx, ref)
	if err != nil || identity == nil {
		return
	}
	s.Record(identity.Name, identity.Stack, kind)
}
