import json
from dataclasses import dataclass, field

@dataclass
class EvalSample:
    query:               str
    reference_answer:    str = ""
    relevant_chunk_ids:  list = field(default_factory=list)

@dataclass
class EvalResult:
    precision_at_k:  float = 0.0
    recall_at_k:     float = 0.0
    mrr:             float = 0.0
    faithfulness:    float = 0.0
    answer_relevance:float = 0.0
    correctness:     float = 0.0
    rationale:       str   = ""

class RAGEvaluator:
    def __init__(self, client):
        self.client = client

    def evaluate_sample(self, sample: EvalSample, retrieved_chunks, generated_answer: str) -> EvalResult:
        retrieved_ids = [c.chunk_id for c in retrieved_chunks]
        relevant      = set(sample.relevant_chunk_ids)

        if relevant:
            hits           = [1 if cid in relevant else 0 for cid in retrieved_ids]
            precision_at_k = sum(hits) / max(len(hits), 1)
            recall_at_k    = sum(hits) / len(relevant)
            mrr            = next((1.0/(i+1) for i, h in enumerate(hits) if h), 0.0)
        else:
            precision_at_k = recall_at_k = mrr = 0.0

        try:
            # LLM quality scores
            context = "\n".join(c.text[:300] for c in retrieved_chunks[:3])
            prompt  = f"""Rate this RAG answer on three dimensions (0-10 each).

    Question: {sample.query}
    Reference: {sample.reference_answer}
    Retrieved context: {context}
    Generated answer: {generated_answer}

    Reply ONLY with JSON (no markdown):
    {{"faithfulness": 8, "answer_relevance": 7, "correctness": 6, "rationale": "one sentence"}}"""

            resp = self.client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=200,
                stream=False,
            )
            raw  = resp.choices[0].message.content.strip()
            raw  = raw.replace("```json", "").replace("```", "").strip()
            data = json.loads(raw)

            return EvalResult(
                precision_at_k   = precision_at_k,
                recall_at_k      = recall_at_k,
                mrr              = mrr,
                faithfulness     = data.get("faithfulness", 0) / 10,
                answer_relevance = data.get("answer_relevance", 0) / 10,
                correctness      = data.get("correctness", 0) / 10,
                rationale        = data.get("rationale", ""),
            )

        except Exception as e:
            # Always return a valid EvalResult, and preserve retrieval metrics even if LLM judging fails.
            return EvalResult(
                precision_at_k=precision_at_k, recall_at_k=recall_at_k, mrr=mrr,
                faithfulness=0.0, answer_relevance=0.0, correctness=0.0,
                rationale=f"Eval error: {e}",
            )
    def aggregate(self, results: list) -> dict:
        """Aggregate eval results across all samples."""
        if not results:
            return {}
        
        def avg(key):
            vals = [getattr(r, key) for r in results if hasattr(r, key)]
            return round(sum(vals) / len(vals), 3) if vals else 0.0

        return {
            "num_samples":       len(results),
            "avg_precision_at_k": avg("precision_at_k"),
            "avg_recall_at_k":    avg("recall_at_k"),
            "avg_mrr":            avg("mrr"),
            "avg_faithfulness":   avg("faithfulness"),
            "avg_answer_relevance": avg("answer_relevance"),
            "avg_correctness":    avg("correctness"),
        }
        # Retrieval metrics
        if relevant:
            hits          = [1 if cid in relevant else 0 for cid in retrieved_ids]
            precision_at_k = sum(hits) / max(len(hits), 1)
            recall_at_k    = sum(hits) / len(relevant)
            mrr            = next((1.0/(i+1) for i, h in enumerate(hits) if h), 0.0)
        else:
            precision_at_k = recall_at_k = mrr = 0.0

        # LLM-based quality scores
        context = "\n".join(c.text[:300] for c in retrieved_chunks[:3])
        prompt  = f"""Rate this RAG answer on three dimensions (0-10 each).

Question: {sample.query}
Reference: {sample.reference_answer}
Retrieved context: {context}
Generated answer: {generated_answer}

Reply ONLY with JSON:
{{"faithfulness": 8, "answer_relevance": 7, "correctness": 6, "rationale": "..."}}"""
        try:
            resp = self.client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=200,
                stream=False,
            )
            data = json.loads(resp.choices[0].message.content.strip())
            return EvalResult(
                precision_at_k   = precision_at_k,
                recall_at_k      = recall_at_k,
                mrr              = mrr,
                faithfulness     = data.get("faithfulness", 0) / 10,
                answer_relevance = data.get("answer_relevance", 0) / 10,
                correctness      = data.get("correctness", 0) / 10,
                rationale        = data.get("rationale", ""),
            )
        except Exception as e:
            return EvalResult(precision_at_k=precision_at_k, recall_at_k=recall_at_k,
                              mrr=mrr, rationale=str(e))
