.PHONY: parse docker-up docker-down test build

docker-up:
	docker compose up -d

docker-down:
	docker compose down

build:
	go build ./...

parse:
	go run ./parser/cmd parse $(REPO)

test:
	go test ./...
