package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
	"testing/fstest"
)

func TestStaticHandlerServesUnderAssetsPrefix(t *testing.T) {
	fsys := fstest.MapFS{"app.js": {Data: []byte("console.log(1)")}}
	rec := httptest.NewRecorder()
	StaticHandler(fsys).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/assets/app.js", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Body.String(); got != "console.log(1)" {
		t.Fatalf("body = %q", got)
	}
}

func TestPageRendererEmbedsBootAsJSONObject(t *testing.T) {
	p, err := NewPageRenderer(`<script type="application/json" id="boot">{{.BootJSON}}</script>`, "test")
	if err != nil {
		t.Fatal(err)
	}
	boot, _ := json.Marshal(map[string]string{"name": "</script><b>x"})
	rec := httptest.NewRecorder()
	if err := p.Render(rec, string(boot), ""); err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`(?s)id="boot">(.*)</script>`).FindStringSubmatch(rec.Body.String())
	if m == nil {
		t.Fatalf("boot script not found or closed early: %s", rec.Body.String())
	}
	var got map[string]string
	if err := json.Unmarshal([]byte(m[1]), &got); err != nil {
		t.Fatalf("boot is not a JSON object: %v (%s)", err, m[1])
	}
	if got["name"] != "</script><b>x" {
		t.Fatalf("name = %q", got["name"])
	}
}

func TestStaticServesPrecompressedGzip(t *testing.T) {
	fsys := fstest.MapFS{
		"app.js":    {Data: []byte("console.log(1)")},
		"app.js.gz": {Data: []byte("GZ")},
	}
	req := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	req.Header.Set("Accept-Encoding", "gzip, br")
	rec := httptest.NewRecorder()
	StaticHandler(fsys).ServeHTTP(rec, req)
	if rec.Header().Get("Content-Encoding") != "gzip" || rec.Body.String() != "GZ" {
		t.Fatalf("esperava o .gz pré-comprimido; headers=%v body=%q", rec.Header(), rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct == "" || ct[:22] != "text/javascript; chars" {
		t.Fatalf("content-type = %q", ct)
	}
}

func TestGzipMiddlewareSkipsStreams(t *testing.T) {
	h := withGzip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("x")) }))
	for path, want := range map[string]string{"/api/status": "gzip", "/api/stream": "", "/api/logs/abc": ""} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Accept-Encoding", "gzip")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if got := rec.Header().Get("Content-Encoding"); got != want {
			t.Errorf("%s: Content-Encoding = %q, want %q", path, got, want)
		}
	}
}
