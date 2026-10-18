package hub

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/davi/homelab-app/internal/config"
	"github.com/davi/homelab-app/internal/model"
)

// Subscriber guarda no máximo uma mensagem pendente por tipo (status, history, ping).
// Cliente lento nunca bloqueia o hub nem acumula memória: a mensagem nova do mesmo tipo
// substitui a antiga, mas um tipo não descarta o outro.
type Subscriber struct {
	host   string
	mu     sync.Mutex
	status []byte
	hist   []byte
	ping   bool
	notify chan struct{}
	done   chan struct{}
	closed bool
}

type Hub struct {
	mu          sync.RWMutex
	subs        map[*Subscriber]struct{}
	lastStatus  map[string][]byte
	lastHistory []byte
}

func New() *Hub {
	return &Hub{
		subs:       map[*Subscriber]struct{}{},
		lastStatus: map[string][]byte{},
	}
}

func (h *Hub) Clients() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.subs)
}

func (h *Hub) ActiveHosts() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	seen := map[string]bool{}
	for s := range h.subs {
		seen[s.host] = true
	}
	out := make([]string, 0, len(seen))
	for host := range seen {
		out = append(out, host)
	}
	return out
}

func (h *Hub) Subscribe(host string) (*Subscriber, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.subs) >= config.SSEMaxClients {
		return nil, errTooManyClients
	}
	s := &Subscriber{host: host, notify: make(chan struct{}, 1), done: make(chan struct{})}
	h.subs[s] = struct{}{}
	if h.lastHistory != nil {
		s.post("history", h.lastHistory)
	}
	return s, nil
}

// Notify sinaliza que há mensagens pendentes; Done fecha quando o hub remove o cliente.
func (s *Subscriber) Notify() <-chan struct{} { return s.notify }
func (s *Subscriber) Done() <-chan struct{}   { return s.done }

// Drain devolve as mensagens pendentes (status antes de history) já no formato SSE.
func (s *Subscriber) Drain() [][]byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out [][]byte
	if s.status != nil {
		out = append(out, appendSSE("status", s.status))
		s.status = nil
	}
	if s.hist != nil {
		out = append(out, appendSSE("history", s.hist))
		s.hist = nil
	}
	if s.ping {
		out = append(out, PingMessage())
		s.ping = false
	}
	return out
}

func (s *Subscriber) post(kind string, data []byte) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	switch kind {
	case "status":
		s.status = data
	case "history":
		s.hist = data
	case "ping":
		s.ping = true
	}
	s.mu.Unlock()
	select {
	case s.notify <- struct{}{}:
	default:
	}
}

func (h *Hub) Unsubscribe(s *Subscriber) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.subs[s]; !ok {
		return
	}
	delete(h.subs, s)
	s.mu.Lock()
	if !s.closed {
		s.closed = true
		close(s.done)
	}
	s.mu.Unlock()
}

var errTooManyClients = &HubError{msg: "too many clients"}

type HubError struct{ msg string }

func (e *HubError) Error() string { return e.msg }
func IsTooManyClients(err error) bool {
	return err != nil && err.Error() == errTooManyClients.Error()
}

// PublishStatus serializa o payload uma vez e entrega aos clientes daquele host.
func (h *Hub) PublishStatus(host string, payload model.PagePayload) bool {
	data, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	h.mu.Lock()
	h.lastStatus[host] = data
	for s := range h.subs {
		if s.host == host || host == "" {
			s.post("status", data)
		}
	}
	h.mu.Unlock()
	return true
}

// SendStatus entrega o snapshot só para um cliente (o que acabou de conectar).
func (h *Hub) SendStatus(s *Subscriber, payload model.PagePayload) {
	if data, err := json.Marshal(payload); err == nil {
		s.post("status", data)
	}
}

func (h *Hub) PublishHistory(events []model.ContainerLifecycleEvent) {
	data, err := json.Marshal(events)
	if err != nil {
		return
	}
	h.mu.Lock()
	h.lastHistory = data
	for s := range h.subs {
		s.post("history", data)
	}
	h.mu.Unlock()
}

func appendSSE(event string, data []byte) []byte {
	return []byte("event: " + event + "\ndata: " + string(data) + "\n\n")
}

func PingMessage() []byte {
	return []byte(": ping\n\n")
}

func RetryLine() []byte {
	return []byte("retry: 3000\n\n")
}

func KeepAliveLoop(h *Hub, stop <-chan struct{}) {
	t := time.NewTicker(time.Duration(config.SSEKeepAliveSec) * time.Second)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			h.mu.RLock()
			for s := range h.subs {
				s.post("ping", nil)
			}
			h.mu.RUnlock()
		}
	}
}
