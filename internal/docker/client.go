package docker

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"

	"github.com/davi/homelab-app/internal/config"
)

const (
	safeContainerRef = `^[A-Za-z0-9][A-Za-z0-9_.-]*$`
)

type Client struct {
	socket string
}

func NewClient() *Client {
	return &Client{socket: config.DockerSocket}
}

func (c *Client) unixRequest(ctx context.Context, method, path string, body []byte, timeout time.Duration) (int, []byte, error) {
	dialer := net.Dialer{Timeout: timeout}
	conn, err := dialer.DialContext(ctx, "unix", c.socket)
	if err != nil {
		return 0, nil, err
	}
	defer conn.Close()

	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	} else {
		_ = conn.SetDeadline(time.Now().Add(timeout))
	}

	var bodyReader io.Reader
	if body != nil {
		bodyReader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://localhost"+path, bodyReader)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Host", "localhost")
	req.Header.Set("Connection", "close")
	if body != nil {
		req.ContentLength = int64(len(body))
	}

	if err := req.Write(conn); err != nil {
		return 0, nil, err
	}

	resp, err := http.ReadResponse(bufio.NewReader(conn), req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, nil, err
	}
	return resp.StatusCode, data, nil
}

func (c *Client) Get(ctx context.Context, path string) ([]byte, error) {
	status, body, err := c.unixRequest(ctx, http.MethodGet, path, nil, time.Duration(config.DockerReadTimeoutSec)*time.Second)
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, fmt.Errorf("Docker API %d: %s", status, string(body))
	}
	return body, nil
}

func (c *Client) GetJSON(ctx context.Context, path string, out interface{}) error {
	body, err := c.Get(ctx, path)
	if err != nil {
		return err
	}
	return json.Unmarshal(body, out)
}

func (c *Client) Request(ctx context.Context, method, path string, body []byte) error {
	timeout := time.Duration(config.DockerActionTimeoutSec) * time.Second
	status, respBody, err := c.unixRequest(ctx, method, path, body, timeout)
	if err != nil {
		return err
	}
	if status >= 400 {
		return fmt.Errorf("Docker API %d: %s", status, string(respBody))
	}
	return nil
}

func (c *Client) OpenStream(ctx context.Context, path string) (io.ReadCloser, error) {
	dialer := net.Dialer{Timeout: time.Duration(config.DockerReadTimeoutSec) * time.Second}
	conn, err := dialer.DialContext(ctx, "unix", c.socket)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://localhost"+path, nil)
	if err != nil {
		conn.Close()
		return nil, err
	}
	req.Header.Set("Host", "localhost")
	req.Header.Set("Connection", "close")
	if err := req.Write(conn); err != nil {
		conn.Close()
		return nil, err
	}
	resp, err := http.ReadResponse(bufio.NewReader(conn), req)
	if err != nil {
		conn.Close()
		return nil, err
	}
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		conn.Close()
		return nil, fmt.Errorf("Docker API %d: %s", resp.StatusCode, string(b))
	}
	return &streamConn{conn: conn, body: resp.Body}, nil
}

type streamConn struct {
	conn net.Conn
	body io.ReadCloser
}

func (s *streamConn) Read(p []byte) (int, error) { return s.body.Read(p) }
func (s *streamConn) Close() error {
	err := s.body.Close()
	_ = s.conn.Close()
	return err
}

func ValidateContainerRef(ref string) (string, error) {
	if ref == "" || !matchSafeRef(ref) {
		return "", fmt.Errorf("Referência de container inválida")
	}
	return url.PathEscape(ref), nil
}

func ValidateStackName(name string) error {
	if name == "" || stringsContainsAny(name, "/", "\x00") {
		return fmt.Errorf("Nome de stack inválido")
	}
	return nil
}

func matchSafeRef(ref string) bool {
	if len(ref) == 0 {
		return false
	}
	for i, r := range ref {
		if i == 0 {
			if !isAlnum(r) {
				return false
			}
			continue
		}
		if isAlnum(r) || r == '_' || r == '.' || r == '-' {
			continue
		}
		return false
	}
	return true
}

func isAlnum(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')
}

func stringsContainsAny(s string, parts ...string) bool {
	for _, p := range parts {
		if p != "" && contains(s, p) {
			return true
		}
	}
	return false
}

func contains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
