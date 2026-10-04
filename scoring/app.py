import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

import joblib
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import config
import db
from scoring import score_entries

log = logging.getLogger("scoring")
state = {"bundle": None}


@asynccontextmanager
async def lifespan(app):
    path = Path(config.MODEL_PATH)
    if path.exists():
        state["bundle"] = joblib.load(path)
        log.info("loaded model %s", path)
    else:
        log.warning("no model at %s, using the fallback rule", path)
    yield


app = FastAPI(lifespan=lifespan)


class ScoreRequest(BaseModel):
    dropId: str


@app.get("/health")
def health():
    return {"ok": True, "model": state["bundle"] is not None}


@app.post("/score")
def score(req: ScoreRequest):
    t0 = time.time()
    with db.connect() as conn:
        status = db.drop_state(conn, req.dropId)
        if status is None:
            raise HTTPException(404, "drop not found")
        if status != "CLOSED":
            raise HTTPException(409, f"drop is {status}, scoring needs CLOSED")
        entries = db.load_entries(conn, req.dropId)
        res = score_entries(entries, state["bundle"])
        if len(res):
            db.write_results(conn, res)
    return {
        "scored": int(len(res)),
        "flagged": int((res["weight"] < 1.0).sum()) if len(res) else 0,
        "durationMs": int((time.time() - t0) * 1000),
    }
