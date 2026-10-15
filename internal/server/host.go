package server

import (
	"net/http"
	"strings"

	"github.com/davi/homelab-app/internal/config"
)

func RequestHost(r *http.Request) string {
	raw := r.Header.Get("X-Forwarded-Host")
	if raw == "" {
		raw = r.Host
	}
	return LinkHost(hostFromRaw(raw))
}

func LinkHost(requestHost string) string {
	if config.LinkHost != "" {
		return hostFromRaw(config.LinkHost)
	}
	return requestHost
}

func hostFromRaw(raw string) string {
	host := strings.Split(raw, ",")[0]
	host = strings.Split(host, ":")[0]
	host = strings.TrimSpace(host)
	if host == "" || host == "0.0.0.0" || host == "[::]" || host == "::" {
		return "localhost"
	}
	return host
}
