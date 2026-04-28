"""
feedback_endpoint.py
Add these to main.py — feedback collection + Precision@K calculation.

Paste into main.py after the existing eval routes.
"""

# ─── In main.py, add this import ─────────────────────────────────────────────
# from pydantic import BaseModel
# (already imported)

# ─── Add this Pydantic model ─────────────────────────────────────────────────

class FeedbackRequest(BaseModel):
    query:      str
    mode:       str
    vote:       str          # "up" | "down"
    confidence: float
    chunk_ids:  list[str]    # ["doc.pdf:7:3", ...]


# ─── Add this endpoint to main.py ────────────────────────────────────────────

FEEDBACK_LOG = "feedback_log.jsonl"

# @app.post("/api/eval/feedback")
def feedback(req: FeedbackRequest):
    """
    Store per-query human feedback for Precision@K computation.
    
    Precision@K formula (computed at dashboard load):
      For each query with vote="up" (correct):
        P@K = (# relevant chunks in top-K) / K
      Where "relevant" = chunk_ids that appeared in a positively-voted response.
    
    Recall@K (requires ground-truth set — approximated here):
      Since we don't have ground truth, we use vote ratio as proxy:
        Recall ≈ up_votes / (up_votes + down_votes)
    """
    import json, time

    entry = {
        "timestamp":  time.strftime("%Y-%m-%dT%H:%M:%S"),
        "query":      req.query,
        "mode":       req.mode,
        "vote":       req.vote,
        "confidence": req.confidence,
        "chunk_ids":  req.chunk_ids,
        "k":          len(req.chunk_ids),
    }

    with open(FEEDBACK_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")

    return {"status": "logged"}


# @app.get("/api/eval/feedback/stats")
def feedback_stats():
    """
    Aggregate feedback into Precision@K and human accuracy metrics.
    
    Returns:
      total_feedback, up_count, down_count,
      human_accuracy (up / total),
      avg_confidence_on_correct,
      avg_confidence_on_incorrect,
      precision_at_k (proxy: fraction of queries voted "up")
    """
    import json, os

    if not os.path.exists(FEEDBACK_LOG):
        return {"total_feedback": 0}

    entries = []
    with open(FEEDBACK_LOG, "r") as f:
        for line in f:
            line = line.strip()
            if line:
                try: entries.append(json.loads(line))
                except: pass

    if not entries:
        return {"total_feedback": 0}

    total   = len(entries)
    up      = [e for e in entries if e["vote"] == "up"]
    down    = [e for e in entries if e["vote"] == "down"]

    avg_conf_correct   = sum(e["confidence"] for e in up)   / len(up)   if up   else 0
    avg_conf_incorrect = sum(e["confidence"] for e in down) / len(down) if down else 0

    return {
        "total_feedback":          total,
        "up_count":                len(up),
        "down_count":              len(down),
        "human_accuracy":          round(len(up) / total * 100, 1),
        "avg_confidence_correct":  round(avg_conf_correct * 100, 1),
        "avg_confidence_incorrect":round(avg_conf_incorrect * 100, 1),
        # Proxy P@K: fraction of feedback-rated queries that were correct
        "precision_at_k":          round(len(up) / total * 100, 1),
        # Confidence calibration: good system should have higher conf on upvotes
        "calibration_delta":       round((avg_conf_correct - avg_conf_incorrect) * 100, 1),
    }


"""
─── EVAL SCHEMA ──────────────────────────────────────────────────────────────

eval_log.jsonl (per query, auto-logged):
{
  "timestamp":       "2026-04-05T12:00:00",
  "query":           "What are the main findings?",
  "mode":            "document" | "general" | "no_context",
  "confidence":      0.72,
  "latency_ms":      1340,
  "precision_at_k":  0.8,    ← fraction of top-K chunks with score > 0.3
  "mrr":             1.0,    ← 1/rank of first high-score chunk
  "chunks": [
    {"doc": "report.pdf", "page": 3, "score": 1.0},
    {"doc": "report.pdf", "page": 7, "score": 0.82}
  ]
}

feedback_log.jsonl (per human vote):
{
  "timestamp":  "2026-04-05T12:01:00",
  "query":      "What are the main findings?",
  "mode":       "document",
  "vote":       "up",
  "confidence": 0.72,
  "chunk_ids":  ["report.pdf:3:1", "report.pdf:7:2"],
  "k":          5
}

─── METRIC FORMULAS ─────────────────────────────────────────────────────────

Precision@K (retrieval quality proxy):
  P@K = |{relevant chunks in top-K}| / K
  "relevant" defined as score >= 0.3 threshold (tunable)

MRR (Mean Reciprocal Rank):
  MRR = avg(1/rank_of_first_relevant_chunk)

Human Accuracy (answer quality):
  HA = up_votes / (up_votes + down_votes)

Confidence Calibration:
  delta = avg_confidence(correct) - avg_confidence(incorrect)
  delta > 0 means confidence is predictive of quality (good)
  delta ≈ 0 means confidence is noise (bad, needs tuning)

─── API ENDPOINTS ────────────────────────────────────────────────────────────

POST /api/eval/feedback        → log vote
GET  /api/eval/feedback/stats  → P@K, HA, calibration
GET  /api/eval/stats           → auto-metrics (P@K, MRR, conf, latency)
GET  /api/eval/log             → raw query log
"""
