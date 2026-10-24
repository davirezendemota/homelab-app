package docker

const (
	StackKindCompose = "compose"
	StackKindSwarm   = "swarm"
)

type StackInfo struct {
	Name string
	Kind string
}

func StackFromLabels(labels map[string]string) StackInfo {
	if labels == nil {
		return StackInfo{Name: "sem stack", Kind: ""}
	}
	if v := labels["com.docker.compose.project"]; v != "" {
		return StackInfo{Name: v, Kind: StackKindCompose}
	}
	if v := labels["com.docker.stack.namespace"]; v != "" {
		return StackInfo{Name: v, Kind: StackKindSwarm}
	}
	return StackInfo{Name: "sem stack", Kind: ""}
}

func ContainerStack(c ListItem) string {
	return StackFromLabels(c.Labels).Name
}

func ContainerStackKind(c ListItem) string {
	return StackFromLabels(c.Labels).Kind
}
