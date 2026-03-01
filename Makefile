.PHONY: parse parse-workspace docker-up docker-down test build

docker-up:
	docker compose up -d

docker-down:
	docker compose down

build:
	go build ./...

parse:
	go run ./parser/cmd parse $(REPO)

parse-workspace:
	go run ./parser/cmd parse $(REPOS) --workspace $(WORKSPACE)

test:
	go test ./...
