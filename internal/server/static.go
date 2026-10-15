package server

import (
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

// StaticHandler serve web/dist em /assets/. Se existir a versão .gz pré-comprimida no
// build e o cliente aceitar gzip, ela é servida no lugar do arquivo original.
// A URL leva ?v=<hash do conteúdo> (ver AssetVersion), então o cache pode ser immutable.
func StaticHandler(fsys fs.FS) http.Handler {
	fileServer := http.StripPrefix("/assets/", http.FileServer(http.FS(fsys)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/assets/")
		if name == "" || strings.HasSuffix(name, "/") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		w.Header().Add("Vary", "Accept-Encoding")
		if acceptsGzip(r) {
			if data, err := fs.ReadFile(fsys, name+".gz"); err == nil {
				if ct := mime.TypeByExtension(path.Ext(name)); ct != "" {
					w.Header().Set("Content-Type", ct)
				}
				w.Header().Set("Content-Encoding", "gzip")
				_, _ = w.Write(data)
				return
			}
		}
		fileServer.ServeHTTP(w, r)
	})
}
