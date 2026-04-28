import json

def rewrite(query, client):
    """Returns (rewritten_query, sub_queries). Falls back gracefully."""
    prompt = f"""Rewrite this search query to be more precise, and generate 2 sub-queries.
Query: {query}

Reply ONLY with JSON: {{"rewritten": "...", "sub_queries": ["...", "..."]}}"""
    try:
        resp = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=150,
            stream=False,
        )
        raw  = resp.choices[0].message.content.strip()
        data = json.loads(raw)
        return data.get("rewritten", query), data.get("sub_queries", [])
    except Exception:
        return query, []