package history

import "testing"

const id = "0123456789abcdef0123"

// AC-RT-03: `docker restart` emite die → start → restart; deve gerar 1 evento "restarted".
func TestDockerRestartYieldsSingleEvent(t *testing.T) {
	s := New()
	s.OnDockerEvent("start", id, "web", "app") // primeiro start visto: "started"
	s.events[0].At -= 60_000                   // o restart acontece bem depois
	s.OnDockerEvent("die", id, "web", "app")
	s.OnDockerEvent("start", id, "web", "app")
	s.OnDockerEvent("restart", id, "web", "app")
	ev := s.Events()
	if len(ev) != 2 || ev[0].Kind != "restarted" || ev[1].Kind != "started" {
		t.Fatalf("eventos = %+v", ev)
	}
}

// AC-RT-04: ação pela API + evento do Docker não duplicam.
func TestAPIActionAndDockerEventDedupe(t *testing.T) {
	s := New()
	s.OnDockerEvent("start", id, "web", "app")
	s.events[0].At -= 60_000
	s.Record("web", "app", "restarted")
	s.OnDockerEvent("restart", id, "web", "app")
	if n := len(s.Events()); n != 2 {
		t.Fatalf("eventos = %+v", s.Events())
	}
}

// Regressão: `start` pela API gerava "restarted" (evento) + "started" (registro da API).
func TestAPIStartAfterDockerEventCountsOnce(t *testing.T) {
	s := New()
	s.OnDockerEvent("start", id, "web", "app")
	s.OnDockerEvent("die", id, "web", "app")
	s.events = nil // isola: só o ciclo stop → start abaixo interessa
	s.OnDockerEvent("start", id, "web", "app")
	s.Record("web", "app", "started")
	if ev := s.Events(); len(ev) != 1 {
		t.Fatalf("eventos = %+v", ev)
	}
}
