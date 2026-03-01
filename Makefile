.PHONY: dev-api dev-ui mock-trace install-api install-ui build-ui dev-full parse parse-workspace docker-up docker-down test build

# --- API / UI ---
install-api:
	pip install -r api/requirements.txt

install-ui:
	cd ui && npm install

build-ui:
	cd ui && npm run build

dev-api:
	uvicorn api.main:app --reload --port 8000

dev-ui:
	cd ui && npm run dev

mock-trace:
	curl -s -X POST http://localhost:8000/api/traces/mock | python3 -m json.tool

# --- Docker ---
docker-up:
	docker compose up -d

docker-down:
	docker compose down

# --- Go parser ---
build:
	go build ./...

parse:
	go run ./parser/cmd parse $(REPO)

parse-workspace:
	go run ./parser/cmd parse $(REPOS) --workspace $(WORKSPACE)

test:
	go test ./...

# --- Phase 4: full dev stack ---
dev-full:
	docker compose up -d falkordb phoenix
	uvicorn api.main:app --reload --port 8000 &
	cd ui && npm run dev
