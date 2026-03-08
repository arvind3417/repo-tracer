from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import traces
from api.routes import graph
from api.routes import diff, search, export, stats

app = FastAPI(title="repo-tracer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(traces.router, prefix="/api")
app.include_router(graph.router, prefix="/api")
app.include_router(diff.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(export.router, prefix="/api")
app.include_router(stats.router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
