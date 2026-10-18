package main

import (
	"context"
	"database/sql"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata" // fuso horário embutido: a imagem final é FROM scratch

	"github.com/davi/homelab-app/internal/config"
	"github.com/davi/homelab-app/internal/docker"
	"github.com/davi/homelab-app/internal/history"
	"github.com/davi/homelab-app/internal/hub"
	"github.com/davi/homelab-app/internal/metrics"
	"github.com/davi/homelab-app/internal/mock"
	"github.com/davi/homelab-app/internal/server"
	"github.com/davi/homelab-app/internal/store"
	webassets "github.com/davi/homelab-app/web"
)

var buildID = "dev"

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(runHealthcheck())
	}
	if err := runServer(); err != nil {
		log.Fatal(err)
	}
}

func runHealthcheck() int {
	port := config.Port
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/healthz")
	if err != nil {
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

func runServer() error {
	// HOMELAB_BUILD_ID (env) tem prioridade; senão vale o -X main.buildID do build.
	if config.ModuleBuild == "dev" && buildID != "dev" {
		config.ModuleBuild = buildID
	}
	log.Printf("homelab v3 boot build=%s mock=%v", config.ModuleBuild, mock.Enabled())

	var db *sql.DB
	var dockerClient *docker.Client
	if !mock.Enabled() {
		dockerClient = docker.NewClient()
		opened, err := store.OpenDB(config.DBPath)
		if err != nil {
			return err
		}
		db = opened
		defer db.Close()
	}

	h := hub.New()
	hist := history.New()
	col := metrics.NewCollector(dockerClient, hist, h)

	staticFS, err := loadStaticFS()
	if err != nil {
		return err
	}
	static := server.StaticHandler(staticFS)

	page, err := server.NewPageRenderer(webassets.IndexHTML, server.AssetVersion(staticFS))
	if err != nil {
		return err
	}

	app := server.NewApp(db, dockerClient, h, hist, col, static, page)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.StartBackground(ctx)

	srv := &http.Server{
		Addr:    ":" + config.Port,
		Handler: app.Handler(),
		BaseContext: func(net.Listener) context.Context {
			return ctx
		},
	}

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		<-sig
		cancel()
		shutdownCtx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = srv.Shutdown(shutdownCtx)
		app.Shutdown()
	}()

	log.Printf("listening on :%s", config.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

func loadStaticFS() (fs.FS, error) {
	if config.HomelabDev {
		return os.DirFS("web/dist"), nil
	}
	sub, err := fs.Sub(webassets.Dist, "dist")
	if err != nil {
		return nil, err
	}
	return sub, nil
}
