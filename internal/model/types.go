package model

type ContainerRow struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Image  string   `json:"image"`
	Status string   `json:"status"`
	Ports  []int    `json:"ports"`
	Stack  string   `json:"stack"`
	Health *string  `json:"health"`
	CPUPct *float64 `json:"cpuPct"`
	MemPct *float64 `json:"memPct"`
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
	CompactView    bool `json:"compactView"`
	TruncateNames  bool `json:"truncateNames"`
	VerticalMeters bool `json:"verticalMeters"`
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
