import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "";

function pct(value) {
  const n = Number(value || 0);
  return Math.max(0, Math.min(100, Math.round(n)));
}

function tokenizeQuery(query) {
  return (query || "")
    .toLowerCase()
    .match(/\b[a-z0-9]{4,}\b/g)
    ?.slice(0, 8) || [];
}

function HighlightText({ text, query }) {
  const terms = tokenizeQuery(query);
  if (!terms.length) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(pattern).map((part, i) =>
    terms.includes(part.toLowerCase()) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>
  );
}

function PanelEmpty({ icon = "DC", title, children, action }) {
  return (
    <div className="panel-empty">
      <div className="panel-empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

function InsightsPanel({ insights, loading, hasDocs, onGenerate }) {
  if (!hasDocs) return (
    <PanelEmpty icon="PDF" title="No documents uploaded">
      Upload PDFs from the sidebar to generate intelligence reports.
    </PanelEmpty>
  );

  if (loading) return (
    <div className="insights-loading">
      <div className="pulse-ring" />
      <p>Analyzing documents...</p>
      <span>Extracting themes, facts, entities, and suggested questions</span>
      <div className="loading-card">
        <div className="skel skel-long" />
        <div className="skel skel-med" />
        <div className="skel skel-short" />
      </div>
    </div>
  );

  if (!insights) return (
    <PanelEmpty
      icon="AI"
      title="Document Intelligence"
      action={<button className="btn-generate" onClick={onGenerate}>Analyze Documents</button>}
    >
      Auto-extract key themes, important facts, entities, and questions from your documents.
    </PanelEmpty>
  );

  return (
    <div className="insights-panel">
      <div className="page-header">
        <div>
          <h2>Intelligence Report</h2>
          <p>Auto-generated from your indexed documents</p>
        </div>
        <button className="btn-regen" onClick={onGenerate}>Regenerate</button>
      </div>

      {insights.executive_summary && (
        <section className="insight-card executive-card">
          <div className="section-kicker">Executive Summary</div>
          <p className="insight-summary-text">{insights.executive_summary}</p>
        </section>
      )}

      {insights.key_themes?.length > 0 && (
        <section className="insight-card">
          <div className="section-kicker">Key Themes</div>
          <div className="theme-grid">
            {insights.key_themes.map((theme, i) => <span key={i} className="theme-chip">{theme}</span>)}
          </div>
        </section>
      )}

      {insights.important_facts?.length > 0 && (
        <section className="insight-card">
          <div className="section-kicker">Important Facts & Figures</div>
          <div className="facts-list">
            {insights.important_facts.map((fact, i) => (
              <div key={i} className="fact-row">
                <span className="fact-num">{String(i + 1).padStart(2, "0")}</span>
                <span className="fact-text">{fact}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {insights.key_entities?.length > 0 && (
        <section className="insight-card">
          <div className="section-kicker">Key Entities</div>
          <div className="entity-cloud">
            {insights.key_entities.map((e, i) => <span key={i} className="entity-tag">{e}</span>)}
          </div>
        </section>
      )}

      {insights.recommended_questions?.length > 0 && (
        <section className="insight-card">
          <div className="section-kicker">Suggested Questions</div>
          <div className="questions-list">
            {insights.recommended_questions.map((q, i) => (
              <div key={i} className="question-row"><span>Q{i + 1}</span>{q}</div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SourcesPanel({ messages }) {
  const last = [...messages].reverse().find(m => m.role === "asst" && !m.loading && m.chunks?.length);

  if (!last) return (
    <PanelEmpty icon="SRC" title="No retrieval data yet">
      Ask a question to see matched document chunks, relevance scores, and source context.
    </PanelEmpty>
  );

  const maxScore = Math.max(...last.chunks.map(c => c.score || 0), 0.001);

  return (
    <div className="sources-view">
      <div className="page-header">
        <div>
          <h2>Source Trace</h2>
          <p>{last.query}</p>
        </div>
        <span className="summary-badge">{last.chunks.length} chunks</span>
      </div>

      <div className="pipeline-row">
        {["Retrieve", `Top ${last.chunks.length}`, "Score", "Answer"].map((s, i) => (
          <span key={i} className="pipe-tag">{s}</span>
        ))}
      </div>

      {last.chunks.map((c, i) => {
        const relevance = pct(((c.score || 0) / maxScore) * 100);
        return (
          <article key={i} className="chunk-card">
            <div className="cc-head">
              <span className="cc-rank">#{i + 1}</span>
              <div className="cc-info">
                <span className="cc-doc">{c.doc_name}</span>
                <span className="cc-loc">Page {c.page_number} / Chunk {c.chunk_index}</span>
              </div>
              <span className="relevance-badge">{relevance}% match</span>
            </div>
            <div className="cc-score-wrap">
              <div className="cc-bar"><div className="cc-bar-fill" style={{ width: `${relevance}%` }} /></div>
            </div>
            <p className="cc-text">
              <HighlightText text={`${c.text.slice(0, 520)}${c.text.length > 520 ? "..." : ""}`} query={last.query} />
            </p>
          </article>
        );
      })}
    </div>
  );
}

function EvalPanel() {
  const [stats, setStats] = useState(null);
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/eval/stats`).then(r => r.json()),
      fetch(`${API}/api/eval/log?limit=50`).then(r => r.json()),
    ]).then(([s, d]) => { setStats(s); setEntries(d.entries || []); })
      .catch(() => {})
      .finally(() => setBusy(false));
  }, []);

  if (busy) return (
    <div className="eval-view">
      <div className="eval-grid">
        {[1, 2, 3, 4].map(i => <div key={i} className="eval-metric skeleton-metric"><div className="skel skel-long" /><div className="skel skel-short" /></div>)}
      </div>
      <div className="loading-card"><div className="skel skel-long" /><div className="skel skel-med" /><div className="skel skel-short" /></div>
    </div>
  );

  return (
    <div className="eval-view">
      <div className="page-header">
        <div>
          <h2>Evaluation Dashboard</h2>
          <p>Runtime quality, relevance, and retrieval behavior</p>
        </div>
      </div>

      {stats && (
        <>
          <div className="eval-grid">
            {[
              { val: stats.total, label: "Total Queries", cls: "" },
              { val: `${stats.avg_conf}%`, label: "Avg Relevance", cls: "metric-accent" },
              { val: `${stats.avg_latency_ms}ms`, label: "Avg Latency", cls: "" },
              { val: `${stats.doc_rate}%`, label: "Doc Hit Rate", cls: "metric-accent" },
            ].map(({ val, label, cls }) => (
              <div key={label} className={`eval-metric ${cls}`}>
                <div className="eval-metric-label">{label}</div>
                <div className="eval-metric-val">{val}</div>
              </div>
            ))}
          </div>

          <div className="dist-card">
            <div className="section-kicker">Answer Source Distribution</div>
            {[
              { label: "Document", pct: stats.doc_rate, cls: "bar-doc" },
              { label: "General", pct: stats.gen_rate, cls: "bar-gen" },
              { label: "No Context", pct: stats.no_ctx_rate, cls: "bar-no" },
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
          <div className="section-kicker">Query Log</div>
          <div className="log-table-wrap">
            <table className="log-table">
              <thead>
                <tr><th>Query</th><th>Source</th><th>Relevance</th><th>Latency</th><th>Time</th></tr>
              </thead>
              <tbody>
                {[...entries].reverse().map((e, i) => (
                  <tr key={i}>
                    <td className="td-q" title={e.query}>{e.query}</td>
                    <td><span className={`mb mb-${e.mode === "document" ? "doc" : e.mode === "general" ? "gen" : "no"}`}>{e.mode === "document" ? "Doc" : e.mode === "general" ? "General" : "None"}</span></td>
                    <td className="td-mono">{Math.round((e.confidence || 0) * 100)}%</td>
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

export { InsightsPanel, SourcesPanel, EvalPanel };
