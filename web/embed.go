package web

import "embed"

//go:embed dist/*
var Dist embed.FS

//go:embed index.html
var IndexHTML string
