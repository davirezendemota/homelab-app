package docker

import (
	"context"
	"strings"
)

type ContainerIdentity struct {
	Name  string
	Stack string
}

func (c *Client) ContainerIdentity(ctx context.Context, ref string) (*ContainerIdentity, error) {
	quoted, err := ValidateContainerRef(ref)
	if err != nil {
		return nil, err
	}
	var info struct {
		Name   string `json:"Name"`
		Config struct {
			Labels map[string]string `json:"Labels"`
		} `json:"Config"`
	}
	if err := c.GetJSON(ctx, "/containers/"+quoted+"/json", &info); err != nil {
		return nil, err
	}
	name := strings.TrimPrefix(info.Name, "/")
	if name == "" {
		return nil, nil
	}
	stack := "sem stack"
	if info.Config.Labels != nil {
		if v := info.Config.Labels["com.docker.compose.project"]; v != "" {
			stack = v
		}
	}
	return &ContainerIdentity{Name: name, Stack: stack}, nil
}
