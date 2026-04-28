"""
backend/main.py (v4.0.0)
New: POST /api/eval/run  — live LLM-judged eval on a single sample
     GET  /api/eval/feedback/stats — human vote P@K
"""
import os, json, asyncio, tempfile
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from rag_retrieval import RAGPipeline, EvalLogger

app = FastAPI(title="DocChat AI", version="4.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

pipeline    = RAGPipeline()
eval_logger = EvalLogger()
ingested:   dict = {}
FEEDBACK_LOG = "feedback_log.jsonl"


class QueryRequest(BaseModel):
    question: str
    history:  list = []
    strict:   bool = True
    eli5:     bool = False

class FeedbackRequest(BaseModel):
    query:      str
    mode:       str
    vote:       str
    confidence: float
    chunk_ids:  list[str]

class EvalSampleRequest(BaseModel):
    query:              str
    reference_answer:   str       = ""
    relevant_chunk_ids: list[str] = []


@app.get("/health")
def health():
    return {"status": "ok", "docs_loaded": len(ingested), "version": "4.0.0"}


@app.post("/api/ingest")
async def ingest(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are supported.")
    content = await file.read()
    with tempfile.NamedTemporaryFile(
        delete=False, suffix=Path(file.filename).suffix,
        prefix=Path(file.filename).stem+"_"
    ) as tmp:
        tmp.write(content); tmp_path = tmp.name
    try:
        n = pipeline.ingest(tmp_path)
    except Exception as e:
        raise HTTPException(500, f"Failed to process PDF: {e}")
    finally:
        try: os.unlink(tmp_path)
        except: pass
    size_kb = round(len(content)/1024, 1)
    ingested[file.filename] = {"chunks": n, "size_kb": size_kb}
    return {"filename": file.filename, "chunks": n, "size_kb": size_kb}


@app.post("/api/query")
async def query(req: QueryRequest):
    if not req.question.strip():
        raise HTTPException(400, "Question cannot be empty.")
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None, lambda: pipeline.query(
                question=req.question, history=req.history,
                strict=req.strict, eli5=req.eli5,
            )
        )
    except Exception as e:
        raise HTTPException(500, f"Query failed: {e}")
    return result.to_dict()


@app.post("/api/insights")
async def insights():
    if not ingested: raise HTTPException(400, "No documents ingested.")
    loop = asyncio.get_event_loop()
    try:
        data = await loop.run_in_executor(None, pipeline.generate_insights)
    except Exception as e:
        raise HTTPException(500, f"Insights failed: {e}")
    return {"insights": data, "doc_count": len(ingested)}


@app.post("/api/eval/run")
async def eval_run(req: EvalSampleRequest):
    """Run one eval sample: full pipeline + LLM-judge scoring."""
    if not ingested: raise HTTPException(400, "Ingest documents first.")
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None, lambda: pipeline.run_eval_on_sample({
                "query": req.query,
                "reference_answer": req.reference_answer,
                "relevant_chunk_ids": req.relevant_chunk_ids,
            })
        )
    except Exception as e:
        raise HTTPException(500, f"Eval failed: {e}")
    return result


@app.post("/api/eval/feedback")
def feedback(req: FeedbackRequest):
    import time
    entry = {"timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
             "query": req.query, "mode": req.mode, "vote": req.vote,
             "confidence": req.confidence, "chunk_ids": req.chunk_ids, "k": len(req.chunk_ids)}
    with open(FEEDBACK_LOG, "a") as f:
        f.write(json.dumps(entry) + "\n")
    return {"status": "logged"}


@app.get("/api/eval/feedback/stats")
def feedback_stats():
    if not os.path.exists(FEEDBACK_LOG): return {"total_feedback": 0}
    entries = []
    with open(FEEDBACK_LOG) as f:
        for line in f:
            try: entries.append(json.loads(line.strip()))
            except: pass
    if not entries: return {"total_feedback": 0}
    total = len(entries)
    up    = [e for e in entries if e["vote"] == "up"]
    down  = [e for e in entries if e["vote"] == "down"]
    ac    = lambda lst: sum(e["confidence"] for e in lst)/len(lst) if lst else 0
    return {
        "total_feedback": total, "up_count": len(up), "down_count": len(down),
        "human_accuracy": round(len(up)/total*100, 1),
        "precision_at_k": round(len(up)/total*100, 1),
        "calibration_delta": round((ac(up)-ac(down))*100, 1),
    }


@app.get("/api/eval/stats")
def eval_stats():    return eval_logger.stats()

@app.get("/api/eval/log")
def eval_log(limit: int = 50): return {"entries": eval_logger.load(limit=limit)}

@app.get("/api/docs-list")
def docs_list():     return {"documents": ingested}

@app.post("/api/clear")
def clear():
    global pipeline, ingested
    pipeline = RAGPipeline(); ingested = {}
    return {"status": "cleared"}