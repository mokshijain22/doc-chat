"""
backend/rag_retrieval.py  (FULL REWRITE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Clean layered architecture:
  DocumentChunker   → ingest layer
  HybridRetriever   → retrieval layer (BM25 + FAISS)
  rewrite()         → query layer
  rerank()          → reranking layer
  _call_llm()       → generation layer
  EvalLogger        → evaluation layer
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import re, os, time, json, logging
import numpy as np
import tiktoken
import pdfplumber
from dataclasses import dataclass
from typing import Literal
from openai import OpenAI
from dotenv import load_dotenv
 
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))

from retrieval.hybrid_retriever import HybridRetriever
from retrieval.reranker         import rerank
from retrieval.query_rewriter   import rewrite
from evaluation.evaluator       import RAGEvaluator, EvalSample
load_dotenv()
logger = logging.getLogger(__name__)

CHUNK_SIZE       = 400
CHUNK_OVERLAP    = 80
CONFIDENCE_FLOOR = 0.12
TOP_K_RETRIEVE   = 10
TOP_K_FINAL      = 5
EVAL_LOG_PATH    = os.environ.get("EVAL_LOG_PATH", "eval_log.jsonl")
LLM_MODEL        = "llama-3.1-8b-instant"

AnswerMode = Literal["document", "general", "no_context"]


@dataclass
class Chunk:
    text:         str
    page_number:  int
    chunk_index:  int
    doc_name:     str
    score:        float = 0.0
    rerank_score: float = 0.0
    bm25_rank:    int   = -1
    dense_rank:   int   = -1
    dense_score:  float = 0.0

    @property
    def chunk_id(self) -> str:
        return f"{self.doc_name}:{self.page_number}:{self.chunk_index}"

    @property
    def citation(self) -> str:
        return f"{self.doc_name} — p.{self.page_number}"

    def to_dict(self) -> dict:
        return {
            "text":         self.text,
            "page_number":  self.page_number,
            "chunk_index":  self.chunk_index,
            "doc_name":     self.doc_name,
            "score":        round(self.score, 3),
            "rerank_score": round(self.rerank_score, 1),
            "bm25_rank":    self.bm25_rank,
            "dense_rank":   self.dense_rank,
            "dense_score":  round(self.dense_score, 4),
            "citation":     self.citation,
            "chunk_id":     self.chunk_id,
        }


@dataclass
class QueryResult:
    answer:          str
    mode:            AnswerMode
    chunks:          list
    confidence:      float
    latency_ms:      int
    query:           str
    rewritten_query: str  = ""
    sub_queries:     list = None
    timings:         dict = None

    def __post_init__(self):
        if self.sub_queries is None: self.sub_queries = []
        if self.timings    is None: self.timings     = {}

    def to_dict(self) -> dict:
        return {
            "answer":          self.answer,
            "mode":            self.mode,
            "chunks":          [c.to_dict() for c in self.chunks],
            "confidence":      round(self.confidence, 3),
            "latency_ms":      self.latency_ms,
            "query":           self.query,
            "rewritten_query": self.rewritten_query,
            "sub_queries":     self.sub_queries,
            "timings":         self.timings,
        }


class DocumentChunker:
    def __init__(self):
        self.enc = tiktoken.get_encoding("cl100k_base")

    def chunk_pdf(self, pdf_path: str) -> list:
        doc_name         = os.path.basename(pdf_path)
        token_page_pairs: list[tuple] = []

        with pdfplumber.open(pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages, start=1):
                text   = page.extract_text() or ""
                tokens = self.enc.encode(text)
                token_page_pairs.extend((tok, page_num) for tok in tokens)

        chunks = []
        step   = CHUNK_SIZE - CHUNK_OVERLAP
        idx    = 0
        c_idx  = 0

        while idx < len(token_page_pairs):
            window = token_page_pairs[idx : idx + CHUNK_SIZE]
            if not window: break
            token_ids = [t for t, _ in window]
            pages     = [p for _, p in window]
            page_num  = max(set(pages), key=pages.count)
            chunks.append(Chunk(
                text=self.enc.decode(token_ids),
                page_number=page_num,
                chunk_index=c_idx,
                doc_name=doc_name,
            ))
            idx   += step
            c_idx += 1
        return chunks


def build_doc_prompt(query: str, rewritten: str, chunks: list, history: list, eli5: bool) -> str:
    context = "\n\n".join(
        f"[SOURCE {i+1} | {c.citation} | rerank: {c.rerank_score:.0f}/10]\n{c.text}"
        for i, c in enumerate(chunks)
    )
    hist_block = ""
    if history:
        lines = [f"{'User' if m['role']=='user' else 'Assistant'}: {m['content'][:300]}"
                 for m in history[-6:]]
        hist_block = "\nCONVERSATION HISTORY:\n" + "\n".join(lines) + "\n"
    eli5_note     = "\nIMPORTANT: Explain like the user is 10 years old." if eli5 else ""
    rewrite_note  = f"\n(Query rewritten: \"{rewritten}\")" if rewritten != query else ""

    return f"""You are DocChat AI, a precise document analyst.
Answer ONLY using the numbered sources below. Cite every claim as [SOURCE N].
Never fabricate. If context is insufficient, say so.{eli5_note}{rewrite_note}
{hist_block}
SOURCES:
{context}

QUESTION: {query}

Respond ONLY with this JSON (no markdown fences):
{{
  "summary": "One sentence TL;DR",
  "key_points": ["Point with [SOURCE N]", "Another with [SOURCE N]"],
  "detailed_answer": "2-4 paragraphs with [SOURCE N] inline citations.",
  "answer_found": true
}}"""


def build_general_prompt(query: str, eli5: bool) -> str:
    eli5_note = " Use simple language." if eli5 else ""
    return f"""You are DocChat AI. Documents don't contain a relevant answer.
Answer from general knowledge.{eli5_note}

QUESTION: {query}

Respond ONLY with this JSON:
{{
  "summary": "One sentence TL;DR",
  "key_points": ["Point 1", "Point 2"],
  "detailed_answer": "[General knowledge — not from your documents]\\n\\nAnswer here.",
  "answer_found": true
}}"""


def build_insights_prompt(sample_text: str) -> str:
    return f"""Analyze these document excerpts and extract structured insights.

EXCERPTS:
{sample_text}

Respond ONLY with this JSON:
{{
  "executive_summary": "2-3 sentence summary",
  "key_themes": ["Theme 1", "Theme 2", "Theme 3", "Theme 4"],
  "important_facts": ["Fact 1", "Fact 2", "Fact 3", "Fact 4", "Fact 5"],
  "key_entities": ["Entity 1", "Entity 2", "Entity 3"],
  "recommended_questions": ["Question 1?", "Question 2?", "Question 3?", "Question 4?"]
}}"""


class EvalLogger:
    def __init__(self, path: str = EVAL_LOG_PATH):
        self.path = path

    def log(self, result: QueryResult):
        entry = {
            "timestamp":       time.strftime("%Y-%m-%dT%H:%M:%S"),
            "query":           result.query,
            "rewritten_query": result.rewritten_query,
            "mode":            result.mode,
            "confidence":      round(result.confidence, 3),
            "latency_ms":      result.latency_ms,
            "timings":         result.timings,
            "chunks": [
                {"id": c.chunk_id, "doc": c.doc_name, "page": c.page_number,
                 "score": round(c.score, 3), "rerank_score": c.rerank_score,
                 "bm25_rank": c.bm25_rank, "dense_rank": c.dense_rank}
                for c in result.chunks
            ],
            "precision_at_k": round(
                sum(1 for c in result.chunks if c.rerank_score >= 6) / max(len(result.chunks), 1), 3
            ),
            "mrr": next(
                (round(1.0/(i+1), 3) for i, c in enumerate(result.chunks) if c.rerank_score >= 6),
                0.0
            ),
        }
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")

    def load(self, limit: int = 100) -> list:
        if not os.path.exists(self.path): return []
        entries = []
        with open(self.path, "r", encoding="utf-8") as f:
            for line in f:
                l = line.strip()
                if l:
                    try: entries.append(json.loads(l))
                    except: pass
        return entries[-limit:]

    def stats(self) -> dict:
        entries = self.load()
        if not entries: return {"total": 0}
        total = len(entries)
        return {
            "total":           total,
            "doc_rate":        round(sum(1 for e in entries if e["mode"]=="document")/total*100, 1),
            "gen_rate":        round(sum(1 for e in entries if e["mode"]=="general")/total*100, 1),
            "no_ctx_rate":     round(sum(1 for e in entries if e["mode"]=="no_context")/total*100, 1),
            "avg_conf":        round(sum(e["confidence"] for e in entries)/total*100, 1),
            "avg_latency_ms":  round(sum(e["latency_ms"] for e in entries)/total),
            "avg_precision_k": round(sum(e.get("precision_at_k",0) for e in entries)/total*100, 1),
            "avg_mrr":         round(sum(e.get("mrr",0) for e in entries)/total*100, 1),
        }


class RAGPipeline:
    def __init__(self):
        self.chunker      = DocumentChunker()
        self.retriever    = None
        self.chunks: list = []
        self.eval_logger  = EvalLogger()
        self.evaluator    = None
        self.client       = OpenAI(
            api_key  = os.environ.get("GROQ_API_KEY"),
            base_url = "https://api.groq.com/openai/v1",
        )

    def ingest(self, pdf_path: str) -> int:
        new_chunks = self.chunker.chunk_pdf(pdf_path)
        self.chunks.extend(new_chunks)
        self.retriever = HybridRetriever(self.chunks)
        return len(new_chunks)

    def _call_llm(self, prompt: str, max_tokens: int = 1024) -> str:
        resp = self.client.chat.completions.create(
            model=LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            stream=False,
        )
        return resp.choices[0].message.content

    def _safe_json(self, raw: str, fallback: str) -> str:
        try:
            clean = raw.replace("```json", "").replace("```", "").strip()
            json.loads(clean)
            return clean
        except json.JSONDecodeError:
            return json.dumps({"summary": None, "key_points": [],
                               "detailed_answer": fallback or raw, "answer_found": bool(fallback)})

    def query(self, question: str, history: list = None, strict: bool = True, eli5: bool = False) -> QueryResult:
        history = history or []
        t_total = time.time()
        timings: dict = {}

        if not self.retriever:
            return QueryResult(
                answer=json.dumps({"summary":"No docs.","key_points":[],"detailed_answer":"Upload a PDF.","answer_found":False}),
                mode="no_context", chunks=[], confidence=0.0, latency_ms=0, query=question,
            )

        # 1. Query rewriting
        t0 = time.time()
        try:
            rewritten, sub_qs = rewrite(question, self.client)
        except Exception as e:
            logger.warning(f"Rewrite failed: {e}")
            rewritten, sub_qs = question, []
        timings["rewrite_ms"] = int((time.time()-t0)*1000)

        # 2. Hybrid retrieval
        t0 = time.time()
        chunks, conf = self.retriever.retrieve(rewritten, top_k=TOP_K_RETRIEVE)
        if sub_qs:
            seen = {(c.doc_name, c.chunk_index) for c in chunks}
            for sq in sub_qs:
                extra, _ = self.retriever.retrieve(sq, top_k=3)
                for ec in extra:
                    if (ec.doc_name, ec.chunk_index) not in seen:
                        chunks.append(ec)
                        seen.add((ec.doc_name, ec.chunk_index))
        timings["retrieval_ms"] = int((time.time()-t0)*1000)

        # 3. Reranking
        t0 = time.time()
        try:
            chunks = rerank(rewritten, chunks, self.client, top_k=TOP_K_FINAL)
        except Exception as e:
            logger.warning(f"Rerank failed: {e}")
            chunks = chunks[:TOP_K_FINAL]
        timings["rerank_ms"] = int((time.time()-t0)*1000)

        # 4. Mode decision
        if conf >= CONFIDENCE_FLOOR:
            mode   = "document"
            prompt = build_doc_prompt(question, rewritten, chunks, history, eli5)
        elif strict:
            result = QueryResult(
                answer=json.dumps({"summary":"Not found.","key_points":[],"detailed_answer":"No relevant content. Try rephrasing or disable Strict Mode.","answer_found":False}),
                mode="no_context", chunks=chunks, confidence=conf,
                latency_ms=int((time.time()-t_total)*1000), query=question,
                rewritten_query=rewritten, sub_queries=sub_qs, timings=timings,
            )
            self.eval_logger.log(result)
            return result
        else:
            mode   = "general"
            prompt = build_general_prompt(question, eli5)
            chunks = []

        # 5. Generation
        t0 = time.time()
        try:
            raw    = self._call_llm(prompt)
            answer = self._safe_json(raw, "")
        except Exception as e:
            answer = json.dumps({"summary":"Error.","key_points":[],"detailed_answer":f"LLM error: {e}","answer_found":False})
            mode   = "no_context"
        timings["generation_ms"] = int((time.time()-t0)*1000)

        result = QueryResult(
            answer=answer, mode=mode, chunks=chunks, confidence=conf,
            latency_ms=int((time.time()-t_total)*1000), query=question,
            rewritten_query=rewritten, sub_queries=sub_qs, timings=timings,
        )
        self.eval_logger.log(result)
        return result

    def generate_insights(self) -> dict:
        if not self.chunks: raise ValueError("No documents ingested.")
        total   = len(self.chunks)
        step    = max(1, total // 12)
        sampled = self.chunks[::step][:12]
        if self.chunks[0] not in sampled:  sampled = [self.chunks[0]] + sampled[:11]
        if self.chunks[-1] not in sampled: sampled.append(self.chunks[-1])
        sample_text = "\n\n---\n\n".join(
            f"[Page {c.page_number} | {c.doc_name}]\n{c.text[:600]}" for c in sampled
        )
        raw = self._call_llm(build_insights_prompt(sample_text), max_tokens=1500)
        try:
            return json.loads(raw.replace("```json","").replace("```","").strip())
        except json.JSONDecodeError:
            return {"executive_summary":"Parse failed.","key_themes":[],"important_facts":[],"key_entities":[],"recommended_questions":[]}

    def run_eval_on_sample(self, sample_dict: dict) -> dict:
        if self.evaluator is None:
            self.evaluator = RAGEvaluator(self.client)
        sample = EvalSample(
            query=sample_dict["query"],
            reference_answer=sample_dict.get("reference_answer",""),
            relevant_chunk_ids=sample_dict.get("relevant_chunk_ids",[]),
        )
        result = self.query(sample.query, strict=False)
        ev     = self.evaluator.evaluate_sample(sample, result.chunks, result.answer)
        return {
            "query":           sample.query,
            "generated_answer":result.answer,
            "retrieved_ids":   [c.chunk_id for c in result.chunks],
            "precision_at_k":  ev.precision_at_k,
            "recall_at_k":     ev.recall_at_k,
            "mrr":             ev.mrr,
            "faithfulness":    ev.faithfulness,
            "answer_relevance":ev.answer_relevance,
            "correctness":     ev.correctness,
            "rationale":       ev.rationale,
        }