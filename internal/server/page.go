package server

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"html/template"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/davi/homelab-app/internal/metrics"
	"github.com/davi/homelab-app/internal/mock"
	"github.com/davi/homelab-app/internal/model"
	"github.com/davi/homelab-app/internal/store"
)

type PageRenderer struct {
	tmpl         *template.Template
	assetVersion string
}

// NewPageRenderer compila o template da página. assetVersion entra na URL de app.js/app.css
// para invalidar o cache (os assets são servidos com Cache-Control immutable).
func NewPageRenderer(html, assetVersion string) (*PageRenderer, error) {
	t, err := template.New("index").Parse(html)
	if err != nil {
		return nil, err
	}
	return &PageRenderer{tmpl: t, assetVersion: assetVersion}, nil
}

// AssetVersion devolve um hash curto do conteúdo de app.js e app.css.
func AssetVersion(fsys fs.FS) string {
	h := sha256.New()
	for _, name := range []string{"app.js", "app.css"} {
		if b, err := fs.ReadFile(fsys, name); err == nil {
			h.Write(b)
		}
	}
	return hex.EncodeToString(h.Sum(nil))[:12]
}

func bodyClass(s model.Settings) string {
	var classes []string
	if s.CompactView {
		classes = append(classes, "compact-view")
	}
	if s.TruncateNames {
		classes = append(classes, "truncate-names")
	}
	if s.VerticalMeters {
		classes = append(classes, "meters-vertical")
	}
	return strings.Join(classes, " ")
}

func (a *App) handlePage(w http.ResponseWriter, r *http.Request) {
	a.touch(r)
	host := RequestHost(r)
	if !mock.Enabled() && a.Collector != nil {
		waitForWarm(a.Collector, 3*time.Second)
	}
	payload := a.pagePayload(host)
	var prefs model.Prefs
	var projects []model.Project
	if mock.Enabled() {
		prefs = mock.Prefs()
		projects = mock.Projects()
	} else {
		prefs, _ = store.ReadPrefs(a.DB)
		projects, _ = store.ListProjects(a.DB)
	}
	if projects == nil {
		projects = []model.Project{}
	}
	boot := model.BootPayload{Data: payload, Prefs: prefs, Projects: projects}
	bootJSON, _ := json.Marshal(boot)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = a.PageTmpl.Render(w, string(bootJSON), bodyClass(prefs.Settings))
}

// bootJSON vem de json.Marshal, que já escapa <, > e &; marcar como template.JS evita
// que o html/template o re-codifique como string literal dentro do <script>.
func (p *PageRenderer) Render(w http.ResponseWriter, bootJSON, bodyClass string) error {
	return p.tmpl.Execute(w, map[string]any{
		"BootJSON":     template.JS(bootJSON),
		"BodyClass":    bodyClass,
		"AssetVersion": p.assetVersion,
	})
}

func waitForWarm(c *metrics.Collector, max time.Duration) {
	// best-effort short wait on first page load
	deadline := time.Now().Add(max)
	for time.Now().Before(deadline) {
		if len(c.PagePayload("").Containers) > 0 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
}
