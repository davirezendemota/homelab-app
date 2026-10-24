package docker

import (
	"bufio"
	"context"
	"encoding/json"
	"net/url"
)

// Event é o subconjunto de campos de GET /events que o app usa.
type Event struct {
	Type   string `json:"Type"`
	Action string `json:"Action"`
	Actor  struct {
		ID         string            `json:"ID"`
		Attributes map[string]string `json:"Attributes"`
	} `json:"Actor"`
}

func (e Event) Name() string { return e.Actor.Attributes["name"] }
func (e Event) Stack() string {
	return StackFromLabels(e.Actor.Attributes).Name
}

// StreamContainerEvents mantém GET /events (só containers) aberto e chama fn para cada
// evento até o contexto ser cancelado ou a conexão cair (retorna o erro nesse caso).
func (c *Client) StreamContainerEvents(ctx context.Context, fn func(Event)) error {
	filters, _ := json.Marshal(map[string][]string{"type": {"container"}})
	stream, err := c.OpenStream(ctx, "/events?filters="+url.QueryEscape(string(filters)))
	if err != nil {
		return err
	}
	defer stream.Close()
	go func() {
		<-ctx.Done()
		stream.Close()
	}()
	dec := json.NewDecoder(bufio.NewReader(stream))
	for {
		var ev Event
		if err := dec.Decode(&ev); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return err
		}
		fn(ev)
	}
}
