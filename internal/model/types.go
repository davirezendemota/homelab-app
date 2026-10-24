package model

type ContainerRow struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Image     string   `json:"image"`
	Status    string   `json:"status"`
	Ports     []int    `json:"ports"`
	Stack     string   `json:"stack"`
	StackKind string   `json:"stackKind,omitempty"`
	Health    *string  `json:"health"`
	CPUPct    *float64 `json:"cpuPct"`
	MemPct    *float64 `json:"memPct"`
}

type ContainerLifecycleEvent struct {
	At    int64  `json:"at"`
	Name  string `json:"name"`
	Stack string `json:"stack"`
	Kind  string `json:"kind"`
}

type StorageMount struct {
	Path    string  `json:"path"`
	Label   string  `json:"label"`
	Pct     int     `json:"pct"`
	UsedGB  float64 `json:"used_gb"`
	TotalGB float64 `json:"total_gb"`
	Color   string  `json:"color"`
}

type Meter map[string]interface{}

// AgentSession é uma sessão de agente de código (Claude Code, Cursor Agent) no host.
type AgentSession struct {
	ID         string  `json:"id"`
	Parent     string  `json:"parent"` // ID da sessão que iniciou este agente (subagent); vazio na raiz
	Kind       string  `json:"kind"`
	Label      string  `json:"label"`
	PID        int     `json:"pid"`
	Cwd        string  `json:"cwd"`
	Folder     string  `json:"folder"` // último segmento de cwd (ex. homelab-app)
	StartedAt  int64   `json:"startedAt"`
	Uptime     string  `json:"uptime"`
	Procs      int     `json:"procs"`
	CPUPct     float64 `json:"cpuPct"`
	CPUDisplay string  `json:"cpuDisplay"`
	MemBytes   uint64  `json:"memBytes"`
	MemDisplay string  `json:"memDisplay"`
	Color      string  `json:"color"`
}

type PagePayload struct {
	Host             string                    `json:"host"`
	Build            string                    `json:"build"`
	LoadedBuild      string                    `json:"loaded_build"`
	Error            *string                   `json:"error"`
	Containers       []ContainerRow            `json:"containers"`
	Meters           []Meter                   `json:"meters"`
	ContainerHistory []ContainerLifecycleEvent `json:"containerHistory"`
}

type Prefs struct {
	Favorites        []string `json:"favorites"`
	HiddenContainers []string `json:"hiddenContainers"`
	HiddenStacks     []string `json:"hiddenStacks"`
	CollapsedStacks  []string `json:"collapsedStacks"`
	Settings         Settings `json:"settings"`
}

type Settings struct {
	CompactView           bool  `json:"compactView"`
	TruncateNames         bool  `json:"truncateNames"`
	VerticalMeters        bool  `json:"verticalMeters"`
	ContainerColumnWidths []int `json:"containerColumnWidths,omitempty"`
}

type Project struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	AccessURL   string   `json:"accessUrl"`
	Environment string   `json:"environment"`
	Containers  []string `json:"containers"`
}

type BootPayload struct {
	Data     PagePayload `json:"data"`
	Prefs    Prefs       `json:"prefs"`
	Projects []Project   `json:"projects"`
}
