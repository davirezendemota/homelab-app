package docker

import "testing"

func TestStackFromLabels(t *testing.T) {
	compose := StackFromLabels(map[string]string{"com.docker.compose.project": "media"})
	if compose.Name != "media" || compose.Kind != StackKindCompose {
		t.Fatalf("compose: got %+v", compose)
	}
	swarm := StackFromLabels(map[string]string{"com.docker.stack.namespace": "monitoring"})
	if swarm.Name != "monitoring" || swarm.Kind != StackKindSwarm {
		t.Fatalf("swarm: got %+v", swarm)
	}
	// Compose wins when both labels exist (typical on compose deploy, not swarm).
	both := StackFromLabels(map[string]string{
		"com.docker.compose.project": "x",
		"com.docker.stack.namespace": "y",
	})
	if both.Name != "x" || both.Kind != StackKindCompose {
		t.Fatalf("both: got %+v", both)
	}
	empty := StackFromLabels(nil)
	if empty.Name != "sem stack" || empty.Kind != "" {
		t.Fatalf("empty: got %+v", empty)
	}
}
