package config

import (
	"os"
	"strings"
)

const (
	CacheFastIntervalSec    = 5
	CacheStorageIntervalSec = 300 // cache do detalhe de armazenamento (sob demanda)
	CollectorIdlePauseSec   = 30
	SSEKeepAliveSec         = 25
	SSEMaxClients           = 32
	LogTail                 = 200
	HistoryMax              = 25
	HistoryDedupeMS         = 4000
	DockerReadTimeoutSec    = 5
	DockerActionTimeoutSec  = 120
	MaxJSONBodyBytes        = 1 << 20
)

var (
	Port         = envOr("PORT", "3000")
	DockerSocket = envOr("DOCKER_SOCKET", "/var/run/docker.sock")
	HostRoot     = strings.TrimSuffix(envOr("HOST_ROOT", "/host"), "/")
	DBPath       = envOr("DB_PATH", "/data/homepage.db")
	LinkHost     = strings.TrimSpace(os.Getenv("LINK_HOST"))
	HomelabDev   = truthy(os.Getenv("HOMELAB_DEV"))
	HomelabMock  = truthy(os.Getenv("HOMELAB_MOCK"))
	ModuleBuild  = moduleBuild()
)

func envOr(key, def string) string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	return v
}

func truthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}

func moduleBuild() string {
	if v := strings.TrimSpace(os.Getenv("HOMELAB_BUILD_ID")); v != "" {
		return v
	}
	return "dev"
}
