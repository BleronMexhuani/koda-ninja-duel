// Package migrations embeds the SQL schema files so the server binary can
// bring a fresh database up to date on start.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
