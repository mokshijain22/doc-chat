# DocChat AI — Production Upgrade Plan

## Architecture (text diagram)

```
┌─────────────────────────────────────────────────────────────────┐
│                         BROWSER                                  │
│                                                                  │
│  ┌──────────────┐  ┌────────────────────────────────────────┐   │
│  │  PDF Viewer  │  │          Chat Panel                    │   │
│  │  (react-pdf) │  │                                        │   │
│  │              │  │  [User bubble]                         │   │
│  │  ← highlight │  │  [TL;DR box]                           │   │
│  │    on cite   │  │  [Key Points] [Source Pills →expand]   │   │
│  │    click     │  │  [Reasoning Panel →expand]             │   │
│  │              │  │  [Feedback ↑ ↓]                        │   │
│  └──────────────┘  └────────────────────────────────────────┘   │
│                                                                  │
│  Tabs: Chat | Insights ✦ | Sources | Eval                       │
└──────────────────────────────────────────────────────────────────┘
          │                           │
          │ /api/ingest               │ /api/query
          │ /api/insights             │ /api/eval/feedback
          ▼                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FastAPI Backend                             │
│                                                                  │
│  RAGPipeline                                                     │
│    ingest(pdf)                                                   │
│      → pdfplumber → tiktoken chunks (400t, 80 overlap)          │
│      → HybridRetriever(chunks)                                   │
│           BM25Okapi + TF-IDF (sklearn)                          │
│           → Reciprocal Rank Fusion                               │
│                                                                  │
│    query(question, history, strict, eli5)                        │
│      → HybridRetriever.retrieve(q, top_k=5)                     │
│      → IDF confidence score                                      │
│      → build_doc_prompt (JSON-enforced)                         │
│      → Groq LLM (llama-3.1-8b-instant)                         │
│      → validate JSON response                                    │
│      → EvalLogger.log (P@K, MRR, auto-metrics)                  │
│                                                                  │
│    generate_insights()                                           │
│      → sample 12 chunks across docs                             │
│      → insights prompt → JSON report                            │
│                                                                  │
│  EvalLogger                                                      │
│    eval_log.jsonl    — auto-metrics per query                    │
│    feedback_log.jsonl — human votes per answer                   │
│                                                                  │
│  Endpoints:                                                      │
│    POST /api/ingest                                              │
│    POST /api/query                                               │
│    POST /api/insights                                            │
│    POST /api/eval/feedback                                       │
│    GET  /api/eval/stats                                          │
│    GET  /api/eval/feedback/stats                                 │
│    GET  /api/eval/log                                            │
│    POST /api/clear                                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Folder Structure

```
docchat-ai/
├── backend/
│   ├── main.py                  ← FastAPI app + all endpoints
│   ├── rag_retrieval.py         ← RAGPipeline, BM25Retriever, EvalLogger
│   ├── retrieval_hybrid.py      ← HybridRetriever (BM25 + TF-IDF + RRF)
│   ├── requirements.txt
│   ├── eval_log.jsonl           ← auto-generated
│   ├── feedback_log.jsonl       ← auto-generated
│   └── .env
│
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── index.css
│       ├── App.jsx              ← main shell, all panels
│       ├── PDFViewer.jsx        ← react-pdf + text highlight
│       ├── ReasoningPanel.jsx   ← "how this was generated" panel
│       └── FeedbackButton.jsx   ← thumbs up/down + POST to backend
│
├── render.yaml
└── README.md
```

---

## Step-by-Step Upgrade Plan (Priority Order)

### P0 — Drop in immediately, zero risk

**1. Swap retriever (5 min)**
```python
# In rag_retrieval.py, RAGPipeline.ingest():
from retrieval_hybrid import HybridRetriever
self.retriever = HybridRetriever(self.chunks)   # was BM25Retriever
```
Add to requirements.txt: `scikit-learn>=1.3`
Result: hybrid BM25 + TF-IDF retrieval. Immediate quality improvement.

**2. Add feedback endpoint (10 min)**
Copy the two functions from `feedback_endpoint.py` into `main.py`.
Add the `FeedbackRequest` model.
Result: every answer can be rated. Eval loop starts collecting real signal.

---

### P1 — Core UX, visible impact

**3. Add FeedbackButton to AsstMessage (5 min)**
```jsx
// In App.jsx, inside AsstMessage, after the followup-row div:
import FeedbackButton from "./FeedbackButton";
// ...
<FeedbackButton msg={msg} />
```

**4. Add ReasoningPanel to AsstMessage (5 min)**
```jsx
import ReasoningPanel from "./ReasoningPanel";
// After FeedbackButton:
<ReasoningPanel msg={msg} />
```

**5. Add PDF viewer split-screen (30 min)**

Install: `npm install react-pdf`

In App.jsx, add state:
```jsx
const [pdfUrl,       setPdfUrl]       = useState(null);
const [activeChunk,  setActiveChunk]  = useState(null);
const [pdfOpen,      setPdfOpen]      = useState(false);
```

Store uploaded file object (not just metadata) in `docs`:
```jsx
// In handleUpload, after setDocs:
setDocs(prev => ({
  ...prev,
  [data.filename]: {
    chunks: data.chunks,
    size_kb: data.size_kb,
    fileObj: URL.createObjectURL(file),  // ← add this
  }
}));
```

Modify the source pill click to open viewer:
```jsx
// In SourcePill onClick:
onClick={() => {
  const fileUrl = docs[chunk.doc_name]?.fileObj;
  if (fileUrl) {
    setPdfUrl(fileUrl);
    setActiveChunk(chunk);
    setPdfOpen(true);
  }
  setOpen(o => !o);
}}
```

Wrap the main area in a split layout:
```jsx
<div className={`main ${pdfOpen ? "split-view" : ""}`}>
  {pdfOpen && (
    <div className="pdf-pane">
      <PDFViewer fileUrl={pdfUrl} activeChunk={activeChunk} onClose={() => setPdfOpen(false)} />
    </div>
  )}
  <div className="chat-pane">
    {/* tabs + tab-body */}
  </div>
</div>
```

Add CSS:
```css
.main { display: flex; flex: 1; overflow: hidden; }
.split-view .pdf-pane { width: 45%; flex-shrink: 0; }
.split-view .chat-pane { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.chat-pane { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
```

---

### P2 — Eval dashboard upgrade

**6. Add feedback stats to Eval tab (15 min)**

In `EvalPanel`, fetch feedback stats:
```jsx
const [fbStats, setFbStats] = useState(null);
useEffect(() => {
  fetch(`${API}/api/eval/feedback/stats`).then(r => r.json()).then(setFbStats).catch(() => {});
}, []);
```

Add to metrics grid:
```jsx
{ val: `${fbStats?.human_accuracy ?? "—"}%`, label: "Human Accuracy" },
{ val: `${fbStats?.precision_at_k ?? "—"}%`, label: "Precision@K (proxy)" },
{ val: `${fbStats?.calibration_delta > 0 ? "+" : ""}${fbStats?.calibration_delta ?? "—"}%`, label: "Confidence Calibration" },
```

---

### P3 — Longer-term upgrades

**7. Replace TF-IDF with sentence-transformers (when Render memory allows)**
```python
# retrieval_hybrid.py — upgrade _tfidf_ranking to use real embeddings
from sentence_transformers import SentenceTransformer
self.embedder = SentenceTransformer("all-MiniLM-L6-v2")  # 80MB
self.embeddings = self.embedder.encode([c.text for c in chunks])

def _semantic_ranking(self, query, n):
    q_emb = self.embedder.encode([query])
    sims  = cosine_similarity(q_emb, self.embeddings).flatten()
    return np.argsort(sims)[::-1][:n].tolist()
```
Then in `retrieve()`, replace `_tfidf_ranking` with `_semantic_ranking`.
RRF fusion code stays identical.

**8. Add cross-encoder reranking (highest quality ceiling)**
```python
from sentence_transformers.cross_encoder import CrossEncoder
reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")

def rerank(query, chunks):
    pairs  = [(query, c.text[:512]) for c in chunks]
    scores = reranker.predict(pairs)
    return [c for _, c in sorted(zip(scores, chunks), reverse=True)]
```
Call after fusion, before returning top_k.

---

## Real Confidence Scoring (replacing fake %)

Current system computes IDF-weighted term overlap. This is **not** fake — it's a real lexical signal. But it should be presented correctly:

```python
# In retrieval_hybrid.py
def confidence_label(conf: float) -> dict:
    if conf >= 0.65: return {"label": "High",   "cls": "conf-high",   "pct": round(conf*100)}
    if conf >= 0.35: return {"label": "Medium", "cls": "conf-medium", "pct": round(conf*100)}
    return              {"label": "Low",    "cls": "conf-low",   "pct": round(conf*100)}
```

In the response, add:
```python
result.to_dict()["confidence_label"] = confidence_label(conf)
```

Frontend display:
```jsx
// Replace bare % number with label
<span className={`conf-label-badge ${msg.confidence_label?.cls}`}>
  {msg.confidence_label?.label} · {msg.confidence_label?.pct}%
</span>
```

---

## Prompt Template (Final)

```python
SYSTEM_PROMPT = """You are DocChat AI — a precise document analyst.
Answer ONLY using the provided context sources. 
Cite every claim as [SOURCE 1], [SOURCE 2] etc.
Never fabricate.{eli5_instruction}

Respond ONLY with this JSON (no markdown fences):
{{
  "summary": "One-sentence TL;DR",
  "key_points": ["Point [SOURCE N]", "Point [SOURCE N]"],
  "detailed_answer": "Full answer with [SOURCE N] citations inline.",
  "answer_found": true | false
}}"""
```

This is enforced at the prompt level. The backend validates JSON after every response and wraps failures gracefully — so the frontend contract never breaks.

---

## What was removed and why

| Removed                        | Reason                                              |
|-------------------------------|-----------------------------------------------------|
| "Relevance 100%" bar          | IDF score was being displayed raw without calibration |
| Generic mode badges (big text) | Replaced with compact color-coded chips              |
| Inline CSS in retrieval panel  | Consolidated into component-scoped styles            |
| Raw chunk text in chat panel  | Moved to collapsible source pills and reasoning panel |
| `docs` panel tab               | Redundant — sidebar already shows indexed docs       |

---

## Dependencies

**Backend additions:**
```
scikit-learn>=1.3
```

**Frontend additions:**
```
react-pdf
```
(pdfjs-dist is included automatically by react-pdf)
