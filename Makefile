.PHONY: run test build db up down smoke

# Start only Postgres in Docker, then run the server locally with live code.
db:
	docker compose up -d db

run:
	DATABASE_URL=$${DATABASE_URL:-postgres://koda:koda@localhost:5432/koda?sslmode=disable} go run ./cmd/server

build:
	go build -o bin/server ./cmd/server

test:
	go vet ./...
	go test ./...

# Full stack in Docker: Postgres + game server on http://localhost:8080
up:
	docker compose up --build -d

down:
	docker compose down

smoke:
	scripts/smoke.sh http://localhost:8080
