.PHONY: dev-api dev-ui mock-trace install-api install-ui build-ui

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
