import { useState, useEffect } from "react";
const API = import.meta.env.VITE_API_URL || "";
/* ─── Insights Panel — Standout Feature ─────────────────────────────────── */
function InsightsPanel({ insights, loading, hasDocs, onGenerate }) {
  if (!hasDocs) return (
    <div className="panel-empty">
      <div className="panel-empty-icon">✦</div>
      <h3>No documents uploaded</h3>
      <p>Upload PDFs from the sidebar to generate intelligence reports.</p>
    </div>
  );

  if (loading) return (
    <div className="insights-loading">
      <div className="pulse-ring" />
      <p>Analyzing documents…</p>
      <span>Extracting themes, facts, and key patterns</span>
    </div>
  );

  if (!insights) return (
    <div className="panel-empty">
      <div className="panel-empty-icon">✦</div>
      <h3>Document Intelligence</h3>
      <p>Auto-extract key themes, important facts, entities, and suggested questions from your documents.</p>
      <button className="btn-generate" onClick={onGenerate}>✦ Analyze Documents</button>
    </div>
  );

  return (
    <div className="insights-panel">
      <div className="insights-header">
        <div>
          <h2>Intelligence Report</h2>
          <p className="insights-sub">Auto-generated from your documents</p>
        </div>
        <button className="btn-regen" onClick={onGenerate}>↺ Regenerate</button>
      </div>

      {insights.executive_summary && (
        <div className="insight-card">
          <div className="insight-card-label">Executive Summary</div>
          <p className="insight-summary-text">{insights.executive_summary}</p>
        </div>
      )}

      {insights.key_themes?.length > 0 && (
        <div className="insight-card">
          <div className="insight-card-label">Key Themes</div>
          <div className="theme-grid">
            {insights.key_themes.map((theme, i) => (
              <div key={i} className="theme-chip">
                <span className="theme-dot">◆</span>{theme}
              </div>
            ))}
          </div>
        </div>
      )}

      {insights.important_facts?.length > 0 && (
        <div className="insight-card">
          <div className="insight-card-label">Important Facts & Figures</div>
          <div className="facts-list">
            {insights.important_facts.map((fact, i) => (
              <div key={i} className="fact-row">
                <span className="fact-num">{String(i + 1).padStart(2, "0")}</span>
                <span className="fact-text">{fact}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {insights.key_entities?.length > 0 && (
        <div className="insight-card">
          <div className="insight-card-label">Key Entities</div>
          <div className="entity-cloud">
            {insights.key_entities.map((e, i) => (
              <span key={i} className="entity-tag">{e}</span>
            ))}
          </div>
        </div>
      )}

      {insights.recommended_questions?.length > 0 && (
        <div className="insight-card">
          <div className="insight-card-label">Suggested Questions to Ask</div>
          <div className="questions-list">
            {insights.recommended_questions.map((q, i) => (
              <div key={i} className="question-row">
                <span className="q-arrow">→</span>{q}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Sources Panel (Retrieval View) ─────────────────────────────────────── */
function SourcesPanel({ messages }) {
  const last = [...messages].reverse().find(m => m.role === "asst" && !m.loading && m.chunks?.length);

  if (!last) return (
    <div className="panel-empty">
      <div className="panel-empty-icon">⊙</div>
      <h3>No retrieval data yet</h3>
      <p>Ask a question to see which document chunks were retrieved and why.</p>
    </div>
  );

  const maxScore = Math.max(...last.chunks.map(c => c.score), 0.001);

  return (
    <div className="sources-view">
      <div className="sv-header">
        <div className="sv-query">"{last.query}"</div>
        <div className="sv-meta">
          {last.chunks.length} chunks · {last.mode} · {Math.round(last.confidence * 100)}% confidence · {last.latency_ms}ms
        </div>
      </div>

      <div className="pipeline-row">
        {["BM25 Retrieval", `Top-${last.chunks.length}`, "IDF Scoring", "Llama 3.1-8B"].map((s, i, arr) => (
          <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="pipe-tag">{s}</span>
            {i < arr.length - 1 && <span className="pipe-arrow">→</span>}
          </span>
        ))}
      </div>

      {last.chunks.map((c, i) => {
        const pct = Math.round((c.score / maxScore) * 100);
        return (
          <div key={i} className="chunk-card">
            <div className="cc-head">
              <span className="cc-rank">#{i + 1}</span>
              <div className="cc-info">
                <span className="cc-doc">{c.doc_name}</span>
                <span className="cc-loc">Page {c.page_number} · Chunk {c.chunk_index}</span>
              </div>
              <div className="cc-score-wrap">
                <div className="cc-bar"><div className="cc-bar-fill" style={{ width: `${pct}%` }} /></div>
                <span className="cc-pct">{pct}%</span>
              </div>
            </div>
            <div className="cc-text">{c.text.slice(0, 480)}{c.text.length > 480 ? "…" : ""}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Eval Panel ─────────────────────────────────────────────────────────── */
function EvalPanel() {
  const [stats,   setStats]   = useState(null);
  const [entries, setEntries] = useState([]);
  const [busy,    setBusy]    = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/eval/stats`).then(r => r.json()),
      fetch(`${API}/api/eval/log?limit=50`).then(r => r.json()),
    ]).then(([s, d]) => { setStats(s); setEntries(d.entries || []); })
      .catch(() => {})
      .finally(() => setBusy(false));
  }, []);

  if (busy) return <div className="panel-empty"><p style={{ color: "var(--tx3)" }}>Loading…</p></div>;

  return (
    <div className="eval-view">
      {stats && (
        <>
          <div className="eval-grid">
            {[
              { val: stats.total,           label: "Total Queries",  accent: false },
              { val: `${stats.avg_conf}%`,  label: "Avg Relevance",  accent: true  },
              { val: `${stats.avg_latency_ms}ms`, label: "Avg Latency", accent: false },
              { val: `${stats.doc_rate}%`,  label: "Doc Hit Rate",   accent: true  },
            ].map(({ val, label, accent }) => (
              <div key={label} className={`eval-metric ${accent ? "metric-accent" : ""}`}>
                <div className="eval-metric-val">{val}</div>
                <div className="eval-metric-label">{label}</div>
              </div>
            ))}
          </div>

          <div className="dist-card">
            <div className="dist-label">Answer Source Distribution</div>
            {[
              { label: "Document",   pct: stats.doc_rate,    cls: "bar-doc" },
              { label: "General",    pct: stats.gen_rate,    cls: "bar-gen" },
              { label: "No Context", pct: stats.no_ctx_rate, cls: "bar-no"  },
            ].map(({ label, pct, cls }) => (
              <div key={label} className="dist-row">
                <span className="dist-lbl">{label}</span>
                <div className="dist-track"><div className={`dist-fill ${cls}`} style={{ width: `${pct}%` }} /></div>
                <span className="dist-pct">{pct}%</span>
              </div>
            ))}
          </div>
        </>
      )}

      {entries.length > 0 && (
        <div className="log-section">
          <div className="log-label">Query Log</div>
          <div className="log-table-wrap">
            <table className="log-table">
              <thead>
                <tr><th>Query</th><th>Source</th><th>Relevance</th><th>Latency</th><th>Time</th></tr>
              </thead>
              <tbody>
                {[...entries].reverse().map((e, i) => (
                  <tr key={i}>
                    <td className="td-q" title={e.query}>{e.query}</td>
                    <td>
                      <span className={`mb mb-${e.mode === "document" ? "doc" : e.mode === "general" ? "gen" : "no"}`}>
                        {e.mode === "document" ? "Doc" : e.mode === "general" ? "General" : "None"}
                      </span>
                    </td>
                    <td className="td-mono">{Math.round(e.confidence * 100)}%</td>
                    <td className="td-mono">{e.latency_ms}ms</td>
                    <td className="td-time">{e.timestamp?.slice(11, 19)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── App Shell ──────────────────────────────────────────────────────────── */
export { InsightsPanel, SourcesPanel, EvalPanel };
