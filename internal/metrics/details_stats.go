package metrics

import (
	"sort"
	"strconv"

	"github.com/davi/homelab-app/internal/docker"
)

func meterDetailFromDockerStats(pairs []docker.StatsPair, ramTotal uint64) (map[string]interface{}, map[string]interface{}) {
	cpuRows := []map[string]interface{}{}
	ramRows := []map[string]interface{}{}
	ramPct, usedGB, totalGB := RamStats()

	for _, p := range pairs {
		name := docker.ContainerName(p.Container)
		stack := docker.ContainerStack(p.Container)
		cpu := docker.ContainerCPUPct(p.Stats)
		mem := docker.ContainerMemoryBytes(p.Stats)
		memPct := docker.ContainerMemPctOfHost(p.Stats, ramTotal)
		cpuRows = append(cpuRows, map[string]interface{}{
			"name": name, "sub": stack, "value": cpu, "display": FormatPct(cpu),
		})
		ramRows = append(ramRows, map[string]interface{}{
			"name": name, "sub": stack, "value": mem,
			"display": FormatBytes(float64(mem)) + " · " + FormatPct(memPct),
		})
	}
	sort.Slice(cpuRows, func(i, j int) bool { return toFloat(cpuRows[i]["value"]) > toFloat(cpuRows[j]["value"]) })
	sort.Slice(ramRows, func(i, j int) bool { return toFloat(ramRows[i]["value"]) > toFloat(ramRows[j]["value"]) })

	return map[string]interface{}{"rows": cpuRows, "total": 100},
		map[string]interface{}{
			"rows":  ramRows,
			"total": max(1, float64(ramTotal)),
			"summary": map[string]interface{}{
				"sub":     strconv.FormatFloat(usedGB, 'f', 1, 64) + " / " + strconv.FormatFloat(totalGB, 'f', 0, 64) + " GB",
				"display": strconv.Itoa(ramPct) + "%",
			},
		}
}
