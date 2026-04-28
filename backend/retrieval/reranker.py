import json

def rerank(query, chunks, client, top_k=5):
    """LLM-based reranker. Falls back to BM25 order on any error."""
    if not chunks:
        return chunks
    numbered = "\n".join(
        f"[{i}] {c.text[:300]}" for i, c in enumerate(chunks)
    )
    prompt = f"""Score each passage 0-10 for relevance to the question.
Question: {query}

Passages:
{numbered}

Reply ONLY with a JSON array of numbers, one per passage, e.g. [8,3,7,...]"""
    try:
        resp = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200,
            stream=False,
        )
        raw    = resp.choices[0].message.content.strip()
        scores = json.loads(raw)
        for i, c in enumerate(chunks):
            c.rerank_score = float(scores[i]) if i < len(scores) else 0.0
        chunks.sort(key=lambda c: c.rerank_score, reverse=True)
    except Exception:
        for c in chunks:
            c.rerank_score = c.score * 10
    return chunks[:top_k]