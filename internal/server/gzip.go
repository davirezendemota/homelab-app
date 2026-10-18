package server

import (
	"compress/gzip"
	"net/http"
	"strings"
	"sync"
)

var gzPool = sync.Pool{New: func() any {
	w, _ := gzip.NewWriterLevel(nil, gzip.BestSpeed)
	return w
}}

type gzipResponseWriter struct {
	http.ResponseWriter
	gz *gzip.Writer
}

func (g *gzipResponseWriter) WriteHeader(status int) {
	g.Header().Del("Content-Length")
	g.ResponseWriter.WriteHeader(status)
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) { return g.gz.Write(b) }

func acceptsGzip(r *http.Request) bool {
	return strings.Contains(r.Header.Get("Accept-Encoding"), "gzip")
}

// withGzip comprime respostas de página e JSON. Streams (SSE e logs) ficam de fora porque
// precisam de flush a cada evento; assets usam os .gz pré-comprimidos no build.
func withGzip(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if !acceptsGzip(r) || p == "/api/stream" || strings.HasPrefix(p, "/api/logs/") ||
			strings.HasPrefix(p, "/assets/") || p == "/healthz" {
			next.ServeHTTP(w, r)
			return
		}
		gz := gzPool.Get().(*gzip.Writer)
		gz.Reset(w)
		defer func() {
			_ = gz.Close()
			gzPool.Put(gz)
		}()
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")
		next.ServeHTTP(&gzipResponseWriter{ResponseWriter: w, gz: gz}, r)
	})
}
