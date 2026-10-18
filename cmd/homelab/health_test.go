package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/davi/homelab-app/internal/hub"
	"github.com/davi/homelab-app/internal/server"
)

func TestHealthz(t *testing.T) {
	app := server.NewApp(nil, nil, hub.New(), nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	app.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if rec.Body.String() != "ok" {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}
