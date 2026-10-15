package metrics

import "syscall"

type syscallStatfs struct {
	Blocks uint64
	Bfree  uint64
	Bsize  uint64
}

func statfs(path string, out *syscallStatfs) error {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return err
	}
	out.Blocks = st.Blocks
	out.Bfree = st.Bfree
	out.Bsize = uint64(st.Bsize)
	return nil
}

// deviceOf devolve o st_dev do caminho (equivalente ao fs.statSync(p).dev da v2).
func deviceOf(path string) (uint64, bool) {
	var st syscall.Stat_t
	if err := syscall.Stat(path, &st); err != nil {
		return 0, false
	}
	return uint64(st.Dev), true
}
