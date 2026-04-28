import re, math
import numpy as np
from rank_bm25 import BM25Okapi

class HybridRetriever:
    def __init__(self, chunks):
        self.chunks = chunks
        tokenised = [self._tok(c.text) for c in chunks]
        self.bm25 = BM25Okapi(tokenised)
        N = len(chunks)
        vocab_df = {}
        for c in chunks:
            for t in set(self._tok(c.text)):
                vocab_df[t] = vocab_df.get(t, 0) + 1
        self._idf = {
            t: math.log((N - df + 0.5) / (df + 0.5) + 1)
            for t, df in vocab_df.items()
        }

    @staticmethod
    def _tok(text):
        return re.findall(r"\b[a-z]{2,}\b", text.lower())

    def _confidence(self, query, top):
        qt = self._tok(query)
        if not qt: return 0.0
        ct = set(self._tok(top.text))
        total = sum(self._idf.get(t, 0.1) for t in qt)
        hit   = sum(self._idf.get(t, 0.1) for t in qt if t in ct)
        return hit / total if total else 0.0

    def retrieve(self, query, top_k=10):
        qt     = self._tok(query)
        scores = self.bm25.get_scores(qt)
        top_i  = np.argsort(scores)[::-1][:top_k].tolist()
        max_sc = scores[top_i[0]] if top_i else 1.0
        result = []
        for rank, i in enumerate(top_i):
            c           = self.chunks[i]
            c.score     = float(scores[i]) / max(max_sc, 1e-9)
            c.bm25_rank = rank
            result.append(c)
        conf = self._confidence(query, result[0]) if result else 0.0
        return result, conf