package docker

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"strings"
	"sync"
)

// DemuxReader remove o cabeçalho de 8 bytes ([stream, 0, 0, 0, tamanho big-endian]) dos
// logs multiplexados de containers sem TTY. Frames e cabeçalhos podem chegar partidos
// entre leituras: os bytes crus ficam em `raw` até o frame completar.
type DemuxReader struct {
	src  io.Reader
	raw  []byte // bytes ainda não processados (pode conter frame/cabeçalho incompleto)
	out  []byte // payload já demultiplexado, aguardando o chamador
	rbuf []byte
	err  error
}

func DemuxDockerLogs(r io.Reader) io.Reader {
	return &DemuxReader{src: r, rbuf: make([]byte, 32*1024)}
}

func (d *DemuxReader) Read(p []byte) (int, error) {
	for len(d.out) == 0 {
		if d.err != nil {
			return 0, d.err
		}
		n, err := d.src.Read(d.rbuf)
		d.raw = append(d.raw, d.rbuf[:n]...)
		d.err = err
		d.parse()
	}
	n := copy(p, d.out)
	d.out = d.out[n:]
	return n, nil
}

func (d *DemuxReader) parse() {
	for len(d.raw) >= 8 {
		size := int(d.raw[4])<<24 | int(d.raw[5])<<16 | int(d.raw[6])<<8 | int(d.raw[7])
		if len(d.raw) < 8+size {
			break
		}
		d.out = append(d.out, d.raw[8:8+size]...)
		d.raw = d.raw[8+size:]
	}
	if len(d.raw) == 0 {
		d.raw = nil // libera o array quando tudo foi consumido
	}
}

func (c *Client) OpenContainerLogStream(ctx context.Context, ref string) (io.ReadCloser, error) {
	if _, err := ValidateContainerRef(ref); err != nil {
		return nil, err
	}
	path, err := c.OpenContainerLogsPath(ref)
	if err != nil {
		return nil, err
	}
	tty, err := c.ContainerHasTTY(ctx, ref)
	if err != nil {
		return nil, err
	}
	stream, err := c.OpenStream(ctx, path)
	if err != nil {
		return nil, err
	}
	if tty {
		return stream, nil
	}
	return struct {
		io.Reader
		io.Closer
	}{Reader: DemuxDockerLogs(stream), Closer: stream}, nil
}

func (c *Client) OpenStackLogStream(ctx context.Context, stack string) (io.ReadCloser, error) {
	if err := ValidateStackName(stack); err != nil {
		return nil, err
	}
	containers, err := c.ContainersInStack(ctx, stack)
	if err != nil {
		return nil, err
	}
	if len(containers) == 0 {
		return nil, fmt.Errorf("Nenhum container nesta stack")
	}
	pr, pw := io.Pipe()
	var pending int = len(containers)
	var mu sync.Mutex
	done := func() {
		mu.Lock()
		pending--
		if pending == 0 {
			_ = pw.Close()
		}
		mu.Unlock()
	}
	for _, cont := range containers {
		go func(name, id string) {
			stream, err := c.OpenContainerLogStream(ctx, id)
			if err != nil {
				_, _ = pw.Write([]byte(fmt.Sprintf("[%s] erro: %v\n", name, err)))
				done()
				return
			}
			prefix := fmt.Sprintf("[%s] ", name)
			scanner := bufio.NewScanner(stream)
			for scanner.Scan() {
				line := scanner.Text()
				_, _ = pw.Write([]byte(prefix + line + "\n"))
			}
			if err := scanner.Err(); err != nil {
				_, _ = pw.Write([]byte(fmt.Sprintf("[%s] erro: %v\n", name, err)))
			}
			_ = stream.Close()
			done()
		}(cont.Name, cont.ID)
	}
	return pr, nil
}

func LinePrefixReader(r io.Reader, prefix string) io.Reader {
	return &prefixReader{r: bufio.NewReader(r), prefix: prefix}
}

type prefixReader struct {
	r       *bufio.Reader
	prefix  string
	pending string
}

func (p *prefixReader) Read(b []byte) (int, error) {
	if len(p.pending) > 0 {
		n := copy(b, p.pending)
		p.pending = p.pending[n:]
		return n, nil
	}
	line, err := p.r.ReadString('\n')
	if err != nil && line == "" {
		return 0, err
	}
	if line != "" && !strings.HasSuffix(line, "\n") {
		line += "\n"
	}
	out := p.prefix + line
	n := copy(b, out)
	if n < len(out) {
		p.pending = out[n:]
	}
	if err != nil {
		return n, err
	}
	return n, nil
}
