"""
retrieval_hybrid.py — Hybrid Retrieval Engine for DocChat AI
────────────────────────────────────────────────────────────
Strategy: BM25 (keyword) + TF-IDF cosine (lexical semantic) fusion.
No HuggingFace models, no GPU, no downloads → works on Render free tier.

Why this works better than BM25-only:
  • BM25 excels at exact keyword matches
  • TF-IDF cosine catches morphological variants and related vocabulary
  • Reciprocal Rank Fusion (RRF) combines both without needing weights

Upgrade path: swap TF-IDF for sentence-transformers later (just change the
_embed method) — everything else stays the same.
"""

import re, math
import numpy as np
from rank_bm25 import BM25Okapi
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from dataclasses import dataclass


# ─── Reciprocal Rank Fusion ───────────────────────────────────────────────────

def reciprocal_rank_fusion(rankings: list[list[int]], k: int = 60) -> list[tuple[int, float]]:
    """
    Fuse multiple ranked lists into a single ranked list.
    rankings: list of [idx_ranked_1st, idx_ranked_2nd, ...] per retriever
    Returns: [(chunk_idx, rrf_score), ...] sorted descending
    """
    scores: dict[int, float] = {}
    for ranking in rankings:
        for rank, chunk_idx in enumerate(ranking):
            scores[chunk_idx] = scores.get(chunk_idx, 0.0) + 1.0 / (k + rank + 1)
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)


# ─── Hybrid Retriever ─────────────────────────────────────────────────────────

class HybridRetriever:
    """
    Drop-in replacement for BM25Retriever in rag_retrieval.py.
    Accepts the same interface: __init__(chunks), retrieve(query, top_k).
    """

    def __init__(self, chunks: list):
        self.chunks = chunks
        texts = [self._clean(c.text) for c in chunks]

        # BM25
        self.bm25 = BM25Okapi([self._tok(t) for t in texts])

        # TF-IDF (lexical semantic)
        self.tfidf = TfidfVectorizer(
            ngram_range=(1, 2),      # unigrams + bigrams
            max_features=30_000,
            sublinear_tf=True,       # log TF to reduce impact of very frequent terms
            min_df=1,
        )
        self.tfidf_matrix = self.tfidf.fit_transform(texts)

        # IDF for confidence calculation
        N = len(chunks)
        vocab_df: dict[str, int] = {}
        for t in texts:
            for tok in set(self._tok(t)):
                vocab_df[tok] = vocab_df.get(tok, 0) + 1
        self._idf = {
            t: math.log((N - df + 0.5) / (df + 0.5) + 1)
            for t, df in vocab_df.items()
        }

    @staticmethod
    def _clean(text: str) -> str:
        return re.sub(r"\s+", " ", text).strip()

    @staticmethod
    def _tok(text: str) -> list[str]:
        return re.findall(r"\b[a-z]{2,}\b", text.lower())

    def _bm25_ranking(self, query: str, n: int) -> list[int]:
        scores = self.bm25.get_scores(self._tok(query))
        return np.argsort(scores)[::-1][:n].tolist()

    def _tfidf_ranking(self, query: str, n: int) -> list[int]:
        q_vec  = self.tfidf.transform([self._clean(query)])
        sims   = cosine_similarity(q_vec, self.tfidf_matrix).flatten()
        return np.argsort(sims)[::-1][:n].tolist()

    def _confidence(self, query: str, top_chunk) -> float:
        qt    = self._tok(query)
        if not qt:
            return 0.0
        ct    = set(self._tok(top_chunk.text))
        total = sum(self._idf.get(t, 0.1) for t in qt)
        hit   = sum(self._idf.get(t, 0.1) for t in qt if t in ct)
        return hit / total if total else 0.0

    def retrieve(self, query: str, top_k: int = 5) -> tuple[list, float]:
        """
        Returns (chunks_ranked, confidence) — same API as BM25Retriever.
        """
        pool = min(top_k * 3, len(self.chunks))  # cast wide net then fuse

        bm25_rank  = self._bm25_ranking(query, pool)
        tfidf_rank = self._tfidf_ranking(query, pool)

        fused = reciprocal_rank_fusion([bm25_rank, tfidf_rank])

        # Take top_k from fused, assign normalized scores
        selected_idx = [idx for idx, _ in fused[:top_k]]
        max_score    = fused[0][1] if fused else 1e-9

        result = []
        for rank_pos, (idx, rrf_score) in enumerate(fused[:top_k]):
            c = self.chunks[idx]
            c.score = rrf_score / max_score  # normalize 0–1
            c.rank  = rank_pos + 1
            result.append(c)

        conf = self._confidence(query, result[0]) if result else 0.0
        return result, conf


# ─── Real Confidence → Label Mapping ─────────────────────────────────────────

def confidence_label(conf: float) -> dict:
    """
    Convert raw IDF confidence score to a human-readable label + color.
    Thresholds calibrated against typical BM25/TF-IDF distributions.
    """
    if conf >= 0.65:
        return {"label": "High",   "cls": "conf-high",   "pct": round(conf * 100) }
    if conf >= 0.35:
        return {"label": "Medium", "cls": "conf-medium",  "pct": round(conf * 100) }
    return      {"label": "Low",   "cls": "conf-low",    "pct": round(conf * 100) }


# ─── How to swap into rag_retrieval.py ───────────────────────────────────────
#
# In RAGPipeline.__init__:
#   from retrieval_hybrid import HybridRetriever
#   # replace: self.retriever = BM25Retriever(self.chunks)
#   # with:    self.retriever = HybridRetriever(self.chunks)
#
# In RAGPipeline.ingest:
#   self.retriever = HybridRetriever(self.chunks)   ← same line, different class
#
# requirements.txt additions:
#   scikit-learn>=1.3
#
# That's it. No other changes needed.