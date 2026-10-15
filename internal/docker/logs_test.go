package docker

import (
	"bytes"
	"io"
	"testing"
	"testing/iotest"
)

func frame(stream byte, payload string) []byte {
	n := len(payload)
	return append([]byte{stream, 0, 0, 0, byte(n >> 24), byte(n >> 16), byte(n >> 8), byte(n)}, payload...)
}

// AC-LOG-01: frames (e cabeçalhos) partidos entre leituras não podem vazar bytes binários.
func TestDemuxHandlesFramesSplitAcrossReads(t *testing.T) {
	var raw []byte
	raw = append(raw, frame(1, "linha um\n")...)
	raw = append(raw, frame(2, "erro dois\n")...)
	raw = append(raw, frame(1, "três\n")...)
	// OneByteReader entrega 1 byte por Read: todo frame e todo cabeçalho chegam partidos.
	got, err := io.ReadAll(DemuxDockerLogs(iotest.OneByteReader(bytes.NewReader(raw))))
	if err != nil {
		t.Fatal(err)
	}
	if want := "linha um\nerro dois\ntrês\n"; string(got) != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestDemuxEmptyFrameAndEOF(t *testing.T) {
	raw := append(frame(1, ""), frame(1, "ok\n")...)
	got, err := io.ReadAll(DemuxDockerLogs(bytes.NewReader(raw)))
	if err != nil || string(got) != "ok\n" {
		t.Fatalf("got %q err %v", got, err)
	}
}
