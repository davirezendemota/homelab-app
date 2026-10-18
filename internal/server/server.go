package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/davi/homelab-app/internal/config"
	"github.com/davi/homelab-app/internal/docker"
	"github.com/davi/homelab-app/internal/history"
	"github.com/davi/homelab-app/internal/hub"
	"github.com/davi/homelab-app/internal/metrics"
	"github.com/davi/homelab-app/internal/mock"
	"github.com/davi/homelab-app/internal/model"
	"github.com/davi/homelab-app/internal/store"
)

type App struct {
	DB        *sql.DB
	Docker    *docker.Client
	Hub       *hub.Hub
	History   *history.Store
	Collector *metrics.Collector
	Static    http.Handler
	PageTmpl  *PageRenderer
	stopHub   chan struct{}
}

func NewApp(db *sql.DB, dockerClient *docker.Client, h *hub.Hub, hist *history.Store, col *metrics.Collector, static http.Handler, page *PageRenderer) *App {
	return &App{DB: db, Docker: dockerClient, Hub: h, History: hist, Collector: col, Static: static, PageTmpl: page, stopHub: make(chan struct{})}
}

func (a *App) StartBackground(ctx context.Context) {
	go hub.KeepAliveLoop(a.Hub, a.stopHub)
	if !mock.Enabled() && a.Collector != nil {
		a.Collector.Start(ctx)
	}
}

func (a *App) Shutdown() {
	close(a.stopHub)
}

func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("GET /api/stream", a.handleStream)
	mux.HandleFunc("GET /api/status", a.handleStatus)
	mux.HandleFunc("GET /api/meters/{kind}", a.handleMeter)
	mux.HandleFunc("GET /api/prefs", a.handleGetPrefs)
	mux.HandleFunc("PUT /api/prefs", a.handlePutPrefs)
	mux.HandleFunc("GET /api/projects", a.handleGetProjects)
	mux.HandleFunc("POST /api/projects", a.handlePostProject)
	mux.HandleFunc("PATCH /api/projects", a.handlePatchProjects)
	mux.HandleFunc("PUT /api/projects/{id}", a.handlePutProject)
	mux.HandleFunc("DELETE /api/projects/{id}", a.handleDeleteProject)
	mux.HandleFunc("POST /api/containers/{ref}/{action}", a.handleContainerAction)
	mux.HandleFunc("DELETE /api/containers/{ref}", a.handleContainerDelete)
	mux.HandleFunc("POST /api/stacks/{name}/{action}", a.handleStackAction)
	mux.HandleFunc("DELETE /api/stacks/{name}", a.handleStackDelete)
	mux.HandleFunc("GET /api/logs/{ref}", a.handleContainerLogs)
	mux.HandleFunc("GET /api/logs/stack/{name}", a.handleStackLogs)
	mux.HandleFunc("GET /{$}", a.handlePage)
	if a.Static != nil {
		mux.Handle("GET /assets/", a.Static)
	}
	return securityHeaders(withGzip(mux))
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:")
		if a := r.Context().Value(activityKey{}); a != nil {
			_ = a
		}
		next.ServeHTTP(w, r)
	})
}

type activityKey struct{}

func (a *App) touch(r *http.Request) {
	if a.Collector != nil && r.URL.Path != "/healthz" {
		a.Collector.TouchActivity()
	}
}

func (a *App) pagePayload(host string) model.PagePayload {
	if mock.Enabled() {
		return mock.PagePayload(host)
	}
	return a.Collector.PagePayload(host)
}

func (a *App) handleStatus(w http.ResponseWriter, r *http.Request) {
	a.touch(r)
	JSON(w, http.StatusOK, a.pagePayload(RequestHost(r)))
}

func (a *App) handleMeter(w http.ResponseWriter, r *http.Request) {
	a.touch(r)
	kind := r.PathValue("kind")
	switch kind {
	case "cpu", "ram", "temp", "storage":
	default:
		JSON(w, http.StatusBadRequest, map[string]interface{}{"kind": kind, "error": "Tipo de métrica inválido"})
		return
	}
	if mock.Enabled() {
		JSON(w, http.StatusOK, mock.MeterDetail(kind))
		return
	}
	if kind == "storage" {
		JSON(w, http.StatusOK, a.Collector.StorageDetail(r.Context()))
		return
	}
	JSON(w, http.StatusOK, a.Collector.MeterDetail(kind))
}

func (a *App) handleGetPrefs(w http.ResponseWriter, r *http.Request) {
	a.touch(r)
	if mock.Enabled() {
		JSON(w, http.StatusOK, mock.Prefs())
		return
	}
	p, err := store.ReadPrefs(a.DB)
	if err != nil {
		ErrorJSON(w, err.Error(), http.StatusInternalServerError)
		return
	}
	JSON(w, http.StatusOK, p)
}

func (a *App) handlePutPrefs(w http.ResponseWriter, r *http.Request) {
	a.touch(r)
	data, err := readJSONObject(w, r)
	if err != nil {
		ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	if mock.Enabled() {
		JSON(w, http.StatusOK, mock.UpdatePrefs(data))
		return
	}
	p, err := store.UpdatePrefs(a.DB, data)
	if err != nil {
		ErrorJSON(w, err.Error(), http.StatusInternalServerError)
		return
	}
	JSON(w, http.StatusOK, p)
}

func (a *App) handleGetProjects(w http.ResponseWriter, r *http.Request) {
	a.touch(r)
	if mock.Enabled() {
		JSON(w, http.StatusOK, map[string]interface{}{"projects": mock.Projects()})
		return
	}
	projects, err := store.ListProjects(a.DB)
	if err != nil {
		ErrorJSON(w, err.Error(), http.StatusInternalServerError)
		return
	}
	JSON(w, http.StatusOK, map[string]interface{}{"projects": projects})
}

func (a *App) handlePostProject(w http.ResponseWriter, r *http.Request) {
	a.touch(r)
	data, err := readJSONObject(w, r)
	if err != nil {
		ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	if mock.Enabled() {
		JSON(w, http.StatusCreated, mock.Projects()[0])
		return
	}
	name := strings.TrimSpace(toString(data["name"]))
	accessURL := toString(data["accessUrl"])
	env := toString(data["environment"])
	p, err := store.CreateProject(a.DB, name, accessURL, env)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "obrigatório") || strings.Contains(err.Error(), "Link") {
			status = http.StatusBadRequest
		}
		ErrorJSON(w, err.Error(), status)
		return
	}
	JSON(w, http.StatusCreated, p)
}

func (a *App) handlePatchProjects(w http.ResponseWriter, r *http.Request) {
	a.touch(r)
	data, err := readJSONObject(w, r)
	if err != nil {
		ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	if mock.Enabled() {
		JSON(w, http.StatusOK, map[string]interface{}{"projects": mock.Projects()})
		return
	}
	orderRaw, ok := data["order"].([]interface{})
	if !ok {
		ErrorJSON(w, "JSON inválido", http.StatusBadRequest)
		return
	}
	order := make([]string, 0, len(orderRaw))
	for _, id := range orderRaw {
		order = append(order, toString(id))
	}
	projects, err := store.ReorderProjects(a.DB, order)
	if err != nil {
		ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	JSON(w, http.StatusOK, map[string]interface{}{"projects": projects})
}

func (a *App) handlePutProject(w http.ResponseWriter, r *http.Request) {
	a.touch(r)
	id := r.PathValue("id")
	data, err := readJSONObject(w, r)
	if err != nil {
		ErrorJSON(w, err.Error(), http.StatusBadRequest)
		return
	}
	if mock.Enabled() {
		JSON(w, http.StatusOK, mock.Projects()[0])
		return
	}
	p, err := store.UpdateProject(a.DB, id, data)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "Projeto não encontrado" {
			status = http.StatusNotFound
		}
		ErrorJSON(w, err.Error(), status)
		return
	}
	JSON(w, http.StatusOK, p)
}

func (a *App) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	a.touch(r)
	id := r.PathValue("id")
	if mock.Enabled() {
		JSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	if err := store.DeleteProject(a.DB, id); err != nil {
		status := http.StatusNotFound
		ErrorJSON(w, err.Error(), status)
		return
	}
	JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *App) handleContainerAction(w http.ResponseWriter, r *http.Request) {
	a.touch(r)
	ref := r.PathValue("ref")
	action := r.PathValue("action")
	ctx := r.Context()
	if mock.Enabled() {
		JSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	var err error
	switch action {
	case "start":
		err = a.Docker.ContainerStart(ctx, ref)
		if err == nil {
			a.History.RecordFromRef(ctx, a.Docker, ref, "started")
		}
	case "stop":
		err = a.Docker.ContainerStop(ctx, ref)
	case "restart":
		err = a.Docker.ContainerRestart(ctx, ref)
		if err == nil {
			a.History.RecordFromRef(ctx, a.Docker, ref, "restarted")
		}
	default:
		ErrorJSON(w, "Not Found", http.StatusNotFound)
		return
	}
	if err != nil {
		writeDockerOrValidation(w, err)
		return
	}
	a.afterAction(ctx, RequestHost(r))
	JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *App) handleContainerDelete(w http.ResponseWriter, r *http.Request) {
	a.touch(r)
	ref := r.PathValue("ref")
	force := parseForce(r)
	if mock.Enabled() {
		JSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	if err := a.Docker.ContainerRemove(r.Context(), ref, force); err != nil {
		writeDockerOrValidation(w, err)
		return
	}
	a.afterAction(r.Context(), RequestHost(r))
	JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *App) handleStackAction(w http.ResponseWriter, r *http.Request) {
	a.touch(r)
	name := r.PathValue("name")
	action := r.PathValue("action")
	ctx := r.Context()
	if mock.Enabled() {
		JSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	var err error
	switch action {
	case "stop":
		err = a.Docker.StackStop(ctx, name)
	case "restart":
		err = a.Docker.StackRestart(ctx, name)
	default:
		ErrorJSON(w, "Not Found", http.StatusNotFound)
		return
	}
	if err != nil {
		writeDockerOrValidation(w, err)
		return
	}
	a.afterAction(ctx, RequestHost(r))
	JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *App) handleStackDelete(w http.ResponseWriter, r *http.Request) {
	a.touch(r)
	name := r.PathValue("name")
	if mock.Enabled() {
		JSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	if err := a.Docker.StackRemove(r.Context(), name); err != nil {
		writeDockerOrValidation(w, err)
		return
	}
	a.afterAction(r.Context(), RequestHost(r))
	JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *App) afterAction(ctx context.Context, host string) {
	if a.Collector != nil {
		a.Collector.Relist(ctx)
		payload := a.Collector.PagePayload(host)
		a.Hub.PublishStatus(host, payload)
	}
}

func (a *App) handleContainerLogs(w http.ResponseWriter, r *http.Request) {
	a.touch(r)
	ref := r.PathValue("ref")
	if mock.Enabled() {
		streamText(w, "mock logs\n")
		return
	}
	stream, err := a.Docker.OpenContainerLogStream(r.Context(), ref)
	if err != nil {
		writeDockerOrValidation(w, err)
		return
	}
	defer stream.Close()
	streamText(w, stream)
}

func (a *App) handleStackLogs(w http.ResponseWriter, r *http.Request) {
	a.touch(r)
	name := r.PathValue("name")
	if mock.Enabled() {
		streamText(w, "[demo] mock stack log\n")
		return
	}
	stream, err := a.Docker.OpenStackLogStream(r.Context(), name)
	if err != nil {
		if err.Error() == "Nenhum container nesta stack" {
			ErrorJSON(w, err.Error(), http.StatusBadGateway)
			return
		}
		writeDockerOrValidation(w, err)
		return
	}
	defer stream.Close()
	streamText(w, stream)
}

func streamText(w http.ResponseWriter, src interface{}) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher, _ := w.(http.Flusher)
	switch s := src.(type) {
	case string:
		_, _ = w.Write([]byte(s))
	case io.Reader:
		buf := make([]byte, 4096)
		for {
			n, err := s.Read(buf)
			if n > 0 {
				_, _ = w.Write(buf[:n])
				if flusher != nil {
					flusher.Flush()
				}
			}
			if err != nil {
				return
			}
		}
	}
}

func writeDockerOrValidation(w http.ResponseWriter, err error) {
	msg := err.Error()
	if strings.Contains(msg, "inválid") {
		ErrorJSON(w, msg, http.StatusBadRequest)
		return
	}
	ErrorJSON(w, msg, http.StatusBadGateway)
}

func parseForce(r *http.Request) bool {
	v := strings.ToLower(r.URL.Query().Get("force"))
	if v == "" {
		return true
	}
	return v == "1" || v == "true" || v == "yes"
}

func readJSONObject(w http.ResponseWriter, r *http.Request) (map[string]interface{}, error) {
	r.Body = http.MaxBytesReader(w, r.Body, config.MaxJSONBodyBytes)
	defer r.Body.Close()
	var data map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		return nil, errors.New("JSON inválido")
	}
	if data == nil {
		return map[string]interface{}{}, nil
	}
	return data, nil
}

func toString(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
