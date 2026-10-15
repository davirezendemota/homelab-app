package hub

import (
	"strings"
	"testing"

	"github.com/davi/homelab-app/internal/config"
	"github.com/davi/homelab-app/internal/model"
)

// Regressão: com buffer único, o history enviado logo após o status descartava o status.
func TestStatusAndHistoryBothDelivered(t *testing.T) {
	h := New()
	h.PublishHistory([]model.ContainerLifecycleEvent{{Name: "a", Kind: "started"}})
	s, err := h.Subscribe("host")
	if err != nil {
		t.Fatal(err)
	}
	h.SendStatus(s, model.PagePayload{Host: "host"})
	msgs := s.Drain()
	if len(msgs) != 2 || !strings.HasPrefix(string(msgs[0]), "event: status") || !strings.HasPrefix(string(msgs[1]), "event: history") {
		t.Fatalf("mensagens = %q", msgs)
	}
}

// AC-RT-06: cliente que não lê não bloqueia o publish nem acumula mensagens.
func TestSlowClientKeepsOnlyLatest(t *testing.T) {
	h := New()
	s, _ := h.Subscribe("h")
	for i := 0; i < 1000; i++ {
		h.PublishStatus("h", model.PagePayload{Host: "h", Build: strings.Repeat("x", i%7)})
	}
	msgs := s.Drain()
	if len(msgs) != 1 || !strings.Contains(string(msgs[0]), `"build":"`+strings.Repeat("x", 999%7)+`"`) {
		t.Fatalf("esperava só o último status, veio %d mensagens: %q", len(msgs), msgs)
	}
}

// AC-RT-07: acima do limite, Subscribe falha.
func TestMaxClients(t *testing.T) {
	h := New()
	for i := 0; i < config.SSEMaxClients; i++ {
		if _, err := h.Subscribe("h"); err != nil {
			t.Fatalf("cliente %d: %v", i, err)
		}
	}
	if _, err := h.Subscribe("h"); !IsTooManyClients(err) {
		t.Fatalf("esperava erro de limite, veio %v", err)
	}
}

func TestUnsubscribeClosesDone(t *testing.T) {
	h := New()
	s, _ := h.Subscribe("h")
	h.Unsubscribe(s)
	select {
	case <-s.Done():
	default:
		t.Fatal("Done não fechou")
	}
	h.PublishStatus("h", model.PagePayload{}) // não deve entrar em pânico
	if h.Clients() != 0 {
		t.Fatal("cliente não removido")
	}
}
