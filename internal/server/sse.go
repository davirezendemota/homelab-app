package server

import (
	"net/http"

	"github.com/davi/homelab-app/internal/hub"
)

func (a *App) handleStream(w http.ResponseWriter, r *http.Request) {
	a.touch(r)
	flusher, ok := w.(http.Flusher)
	if !ok {
		ErrorJSON(w, "streaming não suportado", http.StatusInternalServerError)
		return
	}
	host := RequestHost(r)
	sub, err := a.Hub.Subscribe(host)
	if err != nil {
		if hub.IsTooManyClients(err) {
			ErrorJSON(w, "muitos clientes conectados", http.StatusServiceUnavailable)
			return
		}
		ErrorJSON(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer a.Hub.Unsubscribe(sub)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Connection", "keep-alive")

	_, _ = w.Write(hub.RetryLine())
	flusher.Flush()

	a.Hub.SendStatus(sub, a.pagePayload(host))

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-sub.Done():
			return
		case <-sub.Notify():
			for _, msg := range sub.Drain() {
				if _, err := w.Write(msg); err != nil {
					return
				}
			}
			flusher.Flush()
		}
	}
}
