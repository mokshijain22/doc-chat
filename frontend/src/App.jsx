import { useState, useRef, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "";

/* ─── Structured answer parser ────────────────────────────────────────────── */
function parseStructured(raw) {
  if (!raw) return null;
  try {
    const clean = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    const obj = JSON.parse(clean);
    if (obj.summary !== undefined || obj.detailed_answer !== undefined) return obj;
  } catch (_) {}
  return null;
}

/* ─── Source Pill ─────────────────────────────────────────────────────────── */
function SourcePill({ chunk, idx }) {
  const [open, setOpen] = useState(false);
  const score = Math.round(chunk.score * 100);
  return (
    <div className={`src-pill ${open ? "src-open" : ""}`} onClick={() => setOpen(o => !o)}>
      <div className="src-head">
        <span className="src-idx">[{idx + 1}]</span>
        <span className="src-name">{chunk.doc_name.replace(/\.pdf$/i, "")}</span>
        <span className="src-page">p.{chunk.page_number}</span>
        <div className="src-bar-wrap"><div className="src-bar-fill" style={{ width: `${score}%` }} /></div>
        <span className="src-pct">{score}%</span>
        <span className="src-caret">{open ? "−" : "+"}</span>
      </div>
      {open && (
        <div className="src-preview">{chunk.text.slice(0, 380)}{chunk.text.length > 380 ? "…" : ""}</div>
      )}
    </div>
  );
}

/* ─── Mode Badge ──────────────────────────────────────────────────────────── */
function ModeBadge({ mode }) {
  const cfg = {
    document:   { label: "Document",         cls: "badge-doc", icon: "◉" },
    general:    { label: "General Knowledge", cls: "badge-gen", icon: "◎" },
    no_context: { label: "No Context",        cls: "badge-no",  icon: "◌" },
  };
  const c = cfg[mode] || cfg.no_context;
  return <span className={`mode-badge ${c.cls}`}>{c.icon} {c.label}</span>;
}

/* ─── Confidence Bar ─────────────────────────────────────────────────────── */
function ConfBar({ value }) {
  const pct = Math.round(Math.min(1, value) * 100);
  const cls = pct > 65 ? "conf-hi" : pct > 35 ? "conf-mid" : "conf-lo";
  return (
    <div className="conf-wrap">
      <span className="conf-label">Relevance</span>
      <div className="conf-track"><div className={`conf-fill ${cls}`} style={{ width: `${pct}%` }} /></div>
      <span className="conf-pct">{pct}%</span>
    </div>
  );
}

/* ─── AI Message (structured or raw) ────────────────────────────────────── */
function AsstMessage({ msg, onFollowUp }) {
  const parsed = msg.content ? parseStructured(msg.content) : null;

  return (
    <div className="asst-wrap">
      <div className="asst-meta">
        {msg.mode && <ModeBadge mode={msg.mode} />}
        {msg.latency_ms != null && <span className="latency-chip">{msg.latency_ms}ms</span>}
      </div>

      <div className="asst-card">
        {msg.loading ? (
          <div className="skeleton-wrap">
            <div className="skel skel-short" />
            <div className="skel skel-long" />
            <div className="skel skel-med" />
            <div className="skel skel-long" style={{ width: "90%" }} />
          </div>
        ) : parsed ? (
          <>
            {parsed.summary && (
              <div className="tldr-box">
                <div className="tldr-label"><span className="tldr-icon">◈</span> TL;DR</div>
                <p className="tldr-text">{parsed.summary}</p>
              </div>
            )}
            {parsed.key_points?.length > 0 && (
              <div className="kp-section">
                <div className="kp-label">Key Points</div>
                <ul className="kp-list">
                  {parsed.key_points.map((pt, i) => (
                    <li key={i} className="kp-item">
                      <span className="kp-bullet">→</span><span>{pt}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="detail-text">
              {(parsed.detailed_answer || parsed.answer || "").split("\n").map((line, i) =>
                line.trim() ? <p key={i}>{line}</p> : <br key={i} />
              )}
            </div>
          </>
        ) : (
          <div className="raw-text">
            {(msg.content || "").split("\n").map((line, i) =>
              line.trim() ? <p key={i}>{line}</p> : <br key={i} />
            )}
          </div>
        )}

        {!msg.loading && msg.chunks?.length > 0 && (
          <div className="sources-section">
            <div className="sources-label">Sources used</div>
            <div className="sources-list">
              {msg.chunks.map((c, i) => <SourcePill key={i} chunk={c} idx={i} />)}
            </div>
          </div>
        )}

        {!msg.loading && msg.mode === "document" && msg.confidence != null && (
          <ConfBar value={msg.confidence} />
        )}

        {!msg.loading && (
          <div className="followup-row">
            <button className="followup-btn" onClick={() => onFollowUp("Explain this in more detail")}>
              ⊕ Explain more
            </button>
            <button className="followup-btn" onClick={() => onFollowUp("Give me a simpler explanation")}>
              ⊕ Simplify
            </button>
            <button className="followup-btn" onClick={() => onFollowUp("What are the implications of this?")}>
              ⊕ Implications
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Sidebar ─────────────────────────────────────────────────────────────── */
function Sidebar({ docs, onUpload, onClear, strict, setStrict, eli5, setEli5, uploading, onAnalyze, analyzing }) {
  const fileRef = useRef(null);
  const [drag, setDrag] = useState(false);

  const drop = e => {
    e.preventDefault(); setDrag(false);
    [...e.dataTransfer.files].filter(f => f.name.toLowerCase().endsWith(".pdf")).forEach(onUpload);
  };

  const docCount = Object.keys(docs).length;

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand">
          <div className="brand-mark">DC</div>
          <div>
            <div className="brand-name">DocChat AI</div>
            <div className="brand-tag">Document Intelligence</div>
          </div>
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sec-label">Upload</div>
        <div
          className={`dropzone ${drag ? "dz-active" : ""} ${uploading ? "dz-busy" : ""}`}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={drop}
          onClick={() => !uploading && fileRef.current?.click()}
        >
          <div className="dz-icon">{uploading ? "⟳" : "↑"}</div>
          <div className="dz-text">{uploading ? "Indexing PDF…" : "Drop PDF or click to browse"}</div>
        </div>
        <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: "none" }}
          onChange={e => [...e.target.files].forEach(onUpload)} />
      </div>

      {docCount > 0 && (
        <div className="sidebar-section">
          <div className="sec-label">
            Documents <span className="doc-count">{docCount}</span>
          </div>
          {Object.entries(docs).map(([name, meta]) => (
            <div key={name} className="doc-row">
              <div className="doc-icon">PDF</div>
              <div className="doc-info">
                <div className="doc-name">{name.replace(/\.pdf$/i, "")}</div>
                <div className="doc-meta">{meta.chunks} chunks · {meta.size_kb} KB</div>
              </div>
            </div>
          ))}
          <button
            className="btn-analyze"
            onClick={onAnalyze}
            disabled={analyzing}
          >
            {analyzing ? "⟳ Analyzing…" : "✦ Generate Insights"}
          </button>
        </div>
      )}

      <div className="sidebar-section sidebar-bottom">
        <div className="sec-label">Settings</div>
        {[
          { key: "strict", label: "Strict Mode",   desc: "Doc answers only",   val: strict,    set: setStrict },
          { key: "eli5",   label: "ELI5 Mode",     desc: "Simpler language",   val: eli5,      set: setEli5   },
        ].map(({ key, label, desc, val, set }) => (
          <div key={key} className="toggle">
            <div className="toggle-info">
              <span className="toggle-name">{label}</span>
              <span className="toggle-desc">{desc}</span>
            </div>
            <div className={`toggle-track ${val ? "on" : ""}`} onClick={() => set(v => !v)}>
              <div className="toggle-thumb" />
            </div>
          </div>
        ))}
        <button className="btn-danger" onClick={onClear}>⌫ Clear Session</button>
      </div>
    </aside>
  );
}

/* ─── Chat Panel ─────────────────────────────────────────────────────────── */
function ChatPanel({ messages, loading, onSend, hasDocs }) {
  const [input, setInput] = useState("");
  const bottomRef    = useRef(null);
  const textareaRef  = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const autoResize = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  };

  const send = (text) => {
    const q = (text || input).trim();
    if (!q || loading) return;
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    onSend(q);
  };

  const SUGGESTIONS = [
    "Summarize the key findings",
    "What are the main arguments?",
    "List all important numbers and facts",
    "What conclusions does the document draw?",
  ];

  return (
    <div className="chat-panel">
      <div className="chat-scroll">
        {!messages.length ? (
          <div className="empty-chat">
            <div className="empty-logo">◎</div>
            <h2 className="empty-title">Ask your documents anything</h2>
            <p className="empty-sub">
              Upload PDFs from the sidebar, then ask questions.<br />
              Get structured answers with source citations.
            </p>
            {hasDocs && (
              <div className="suggestions">
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} className="sug-chip" onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="msg-list">
            {messages.map((msg, i) => (
              <div key={i} className={`msg-row ${msg.role}`}>
                {msg.role === "user" ? (
                  <div className="user-bubble">{msg.content}</div>
                ) : (
                  <AsstMessage msg={msg} onFollowUp={send} />
                )}
              </div>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="input-dock">
        <div className={`input-box ${loading ? "input-busy" : ""}`}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => { setInput(e.target.value); autoResize(); }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={hasDocs ? "Ask anything about your documents…" : "Upload a PDF first to begin…"}
            rows={1}
            disabled={loading}
          />
          <button
            className={`send-btn ${input.trim() && !loading ? "send-ready" : ""}`}
            onClick={() => send()}
            disabled={!input.trim() || loading}
          >
            {loading ? <span className="send-spin">⟳</span> : "↑"}
          </button>
        </div>
        <div className="input-hint">↵ send · ⇧↵ new line</div>
      </div>
    </div>
  );
}

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
export default function App() {
  const [messages,  setMessages]  = useState([]);
  const [docs,      setDocs]      = useState({});
  const [strict,    setStrict]    = useState(true);
  const [eli5,      setEli5]      = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState("chat");
  const [insights,  setInsights]  = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  /* ── Upload ── */
  const handleUpload = useCallback(async file => {
    if (!file.name.toLowerCase().endsWith(".pdf") || docs[file.name]) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`${API}/api/ingest`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setDocs(prev => ({ ...prev, [data.filename]: { chunks: data.chunks, size_kb: data.size_kb } }));
    } catch (e) {
      alert(`Upload failed: ${e.message}`);
    } finally {
      setUploading(false);
    }
  }, [docs]);

  /* ── Query ── */
  const handleSend = useCallback(async question => {
    if (!Object.keys(docs).length) { alert("Please upload a PDF first."); return; }
    const history = messagesRef.current.map(m => ({
      role: m.role === "asst" ? "assistant" : "user",
      content: m.content || "",
    }));

    setMessages(prev => [
      ...prev,
      { role: "user", content: question },
      { role: "asst", content: "", loading: true, mode: null, chunks: [], query: question },
    ]);
    setLoading(true);

    try {
      const res = await fetch(`${API}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history, strict, eli5 }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1
          ? { role: "asst", content: data.answer, mode: data.mode, chunks: data.chunks || [],
              confidence: data.confidence, latency_ms: data.latency_ms, query: question, loading: false }
          : m
      ));
    } catch (e) {
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1
          ? { role: "asst", content: `Error: ${e.message}`, mode: "no_context", chunks: [], loading: false, query: question }
          : m
      ));
    } finally {
      setLoading(false);
    }
  }, [docs, strict, eli5]);

  /* ── Insights ── */
  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setActiveTab("insights");
    try {
      const res = await fetch(`${API}/api/insights`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setInsights(data.insights);
    } catch (e) {
      alert(`Analysis failed: ${e.message}`);
    } finally {
      setAnalyzing(false);
    }
  }, []);

  /* ── Clear ── */
  const handleClear = useCallback(async () => {
    await fetch(`${API}/api/clear`, { method: "POST" }).catch(() => {});
    setMessages([]); setDocs({}); setInsights(null);
  }, []);

  const hasDocs = Object.keys(docs).length > 0;
  const TABS = [
    { id: "chat",      label: "Chat" },
    { id: "insights",  label: "Insights ✦" },
    { id: "sources",   label: "Sources" },
    { id: "eval",      label: "Eval" },
  ];

  return (
    <div className="shell">
      <Sidebar
        docs={docs} onUpload={handleUpload} onClear={handleClear}
        strict={strict} setStrict={setStrict} eli5={eli5} setEli5={setEli5}
        uploading={uploading} onAnalyze={handleAnalyze} analyzing={analyzing}
      />

      <div className="main">
        <div className="tabs">
          {TABS.map(t => (
            <button key={t.id} className={`tab ${activeTab === t.id ? "tab-active" : ""}`}
              onClick={() => setActiveTab(t.id)}>
              {t.label}
            </button>
          ))}
          <div className="tabs-right">
            {hasDocs && <span className="doc-indicator">● {Object.keys(docs).length} doc{Object.keys(docs).length > 1 ? "s" : ""} indexed</span>}
          </div>
        </div>

        <div className="tab-body">
          {activeTab === "chat"     && <ChatPanel messages={messages} loading={loading} onSend={handleSend} hasDocs={hasDocs} />}
          {activeTab === "insights" && <InsightsPanel insights={insights} loading={analyzing} hasDocs={hasDocs} onGenerate={handleAnalyze} />}
          {activeTab === "sources"  && <SourcesPanel messages={messages} />}
          {activeTab === "eval"     && <EvalPanel />}
        </div>
      </div>

      {/* ── Styles ────────────────────────────────────────────────────────── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&family=DM+Mono:wght@400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg:     #09090B;
          --s1:     #111113;
          --s2:     #18181B;
          --s3:     #1F1F23;
          --s4:     #26262C;
          --bd:     rgba(255,255,255,0.07);
          --bd2:    rgba(255,255,255,0.13);
          --tx:     #F4F4F5;
          --tx2:    #A1A1AA;
          --tx3:    #71717A;
          --gold:   #F59E0B;
          --gold-d: rgba(245,158,11,0.12);
          --gold-b: rgba(245,158,11,0.25);
          --blue:   #6366F1;
          --blue-d: rgba(99,102,241,0.12);
          --green:  #22C55E;
          --green-d:rgba(34,197,94,0.12);
          --red:    #EF4444;
          --red-d:  rgba(239,68,68,0.12);
          --font:   'DM Sans', -apple-system, sans-serif;
          --mono:   'DM Mono', monospace;
        }

        body {
          font-family: var(--font);
          background: var(--bg);
          color: var(--tx);
          height: 100vh;
          overflow: hidden;
          font-size: 14px;
          line-height: 1.6;
          -webkit-font-smoothing: antialiased;
        }
        #root { height: 100vh; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--bd2); border-radius: 2px; }
        button { font-family: var(--font); cursor: pointer; }
        textarea, input { font-family: var(--font); }

        /* Shell */
        .shell { display: flex; height: 100vh; overflow: hidden; }

        /* ── Sidebar ── */
        .sidebar { width: 240px; background: var(--s1); border-right: 1px solid var(--bd); display: flex; flex-direction: column; overflow-y: auto; flex-shrink: 0; }
        .sidebar-top { padding: 20px 16px 14px; border-bottom: 1px solid var(--bd); }
        .brand { display: flex; align-items: center; gap: 10px; }
        .brand-mark { width: 36px; height: 36px; background: var(--gold); color: #09090B; font-weight: 700; font-size: .82rem; letter-spacing: -.5px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .brand-name { font-size: .95rem; font-weight: 600; letter-spacing: -.3px; }
        .brand-tag { font-size: .6rem; color: var(--tx3); text-transform: uppercase; letter-spacing: .9px; margin-top: 1px; }
        .sidebar-section { padding: 14px 16px; border-bottom: 1px solid var(--bd); display: flex; flex-direction: column; gap: 8px; }
        .sidebar-bottom { margin-top: auto; border-bottom: none; border-top: 1px solid var(--bd); }
        .sec-label { font-size: .6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: var(--tx3); margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }
        .doc-count { background: var(--s3); color: var(--tx2); padding: 1px 6px; border-radius: 4px; font-size: .65rem; }

        .dropzone { border: 1.5px dashed var(--bd2); border-radius: 10px; padding: 18px 14px; text-align: center; cursor: pointer; transition: all .2s; display: flex; flex-direction: column; align-items: center; gap: 5px; }
        .dropzone:hover, .dz-active { border-color: var(--gold); background: var(--gold-d); }
        .dz-busy { opacity: .6; cursor: wait; }
        .dz-icon { font-size: 1.4rem; color: var(--tx3); transition: color .2s; }
        .dropzone:hover .dz-icon, .dz-active .dz-icon { color: var(--gold); }
        .dz-text { font-size: .7rem; color: var(--tx3); line-height: 1.5; }

        .doc-row { display: flex; align-items: center; gap: 8px; background: var(--s2); border-radius: 8px; padding: 8px 10px; border: 1px solid var(--bd); }
        .doc-icon { font-size: .55rem; font-weight: 700; font-family: var(--mono); background: var(--gold-d); color: var(--gold); padding: 2px 5px; border-radius: 4px; border: 1px solid var(--gold-b); flex-shrink: 0; letter-spacing: .5px; }
        .doc-info { min-width: 0; }
        .doc-name { font-size: .73rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .doc-meta { font-size: .62rem; color: var(--tx3); margin-top: 1px; }

        .btn-analyze { width: 100%; padding: 8px; background: var(--gold-d); border: 1px solid var(--gold-b); border-radius: 8px; color: var(--gold); font-size: .73rem; font-weight: 500; transition: all .2s; }
        .btn-analyze:hover:not(:disabled) { background: var(--gold-b); }
        .btn-analyze:disabled { opacity: .5; cursor: default; }

        .toggle { display: flex; align-items: center; justify-content: space-between; }
        .toggle-info { display: flex; flex-direction: column; gap: 1px; }
        .toggle-name { font-size: .75rem; color: var(--tx2); font-weight: 500; }
        .toggle-desc { font-size: .6rem; color: var(--tx3); }
        .toggle-track { width: 32px; height: 18px; background: var(--s4); border-radius: 9px; position: relative; transition: background .2s; flex-shrink: 0; border: 1px solid var(--bd2); cursor: pointer; }
        .toggle-track.on { background: var(--gold); border-color: var(--gold); }
        .toggle-thumb { position: absolute; width: 12px; height: 12px; background: white; border-radius: 50%; top: 2px; left: 2px; transition: left .2s; }
        .toggle-track.on .toggle-thumb { left: 16px; }
        .btn-danger { width: 100%; padding: 8px; background: transparent; border: 1px solid var(--bd2); border-radius: 8px; color: var(--tx3); font-size: .7rem; transition: all .15s; margin-top: 4px; }
        .btn-danger:hover { border-color: var(--red); color: var(--red); background: var(--red-d); }

        /* ── Main ── */
        .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .tabs { display: flex; align-items: center; border-bottom: 1px solid var(--bd); background: var(--s1); flex-shrink: 0; padding: 0 6px; }
        .tab { padding: 12px 16px; font-size: .75rem; font-weight: 500; color: var(--tx3); background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; transition: all .15s; margin-bottom: -1px; }
        .tab:hover { color: var(--tx2); }
        .tab-active { color: var(--gold) !important; border-bottom-color: var(--gold) !important; }
        .tabs-right { margin-left: auto; padding-right: 14px; }
        .doc-indicator { font-size: .65rem; color: var(--green); font-weight: 500; }
        .tab-body { flex: 1; overflow: hidden; display: flex; flex-direction: column; }

        /* ── Chat ── */
        .chat-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .chat-scroll { flex: 1; overflow-y: auto; padding: 28px 32px; display: flex; flex-direction: column; }
        .empty-chat { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 14px; padding: 48px 24px; }
        .empty-logo { font-size: 3rem; color: var(--gold); opacity: .5; }
        .empty-title { font-size: 1.4rem; font-weight: 600; letter-spacing: -.4px; }
        .empty-sub { font-size: .83rem; color: var(--tx3); max-width: 320px; line-height: 1.75; }
        .suggestions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; max-width: 520px; margin-top: 6px; }
        .sug-chip { padding: 7px 16px; background: var(--s2); border: 1px solid var(--bd2); border-radius: 20px; color: var(--tx2); font-size: .75rem; transition: all .15s; }
        .sug-chip:hover { background: var(--s3); border-color: var(--gold); color: var(--gold); }

        .msg-list { display: flex; flex-direction: column; gap: 22px; }
        .msg-row { display: flex; }
        .msg-row.user { justify-content: flex-end; }
        .msg-row.asst { justify-content: flex-start; }
        .user-bubble { max-width: 70%; background: var(--blue); color: white; padding: 11px 16px; border-radius: 18px 18px 4px 18px; font-size: .875rem; line-height: 1.7; }

        .asst-wrap { display: flex; flex-direction: column; gap: 6px; max-width: 86%; width: 100%; }
        .asst-meta { display: flex; align-items: center; gap: 8px; padding-left: 2px; }
        .mode-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius: 20px; font-size: .62rem; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; }
        .badge-doc { background: var(--green-d); color: var(--green); }
        .badge-gen { background: var(--blue-d); color: var(--blue); }
        .badge-no  { background: var(--red-d); color: var(--red); }
        .latency-chip { font-size: .6rem; color: var(--tx3); font-family: var(--mono); }

        .asst-card { background: var(--s2); border: 1px solid var(--bd); border-radius: 4px 16px 16px 16px; padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; }

        /* Skeleton */
        .skeleton-wrap { display: flex; flex-direction: column; gap: 9px; }
        .skel { background: var(--s3); border-radius: 4px; height: 13px; animation: shimmer 1.5s ease infinite; }
        .skel-short { width: 55%; } .skel-long { width: 100%; } .skel-med { width: 78%; }
        @keyframes shimmer { 0%,100% { opacity:.3 } 50% { opacity:.7 } }

        /* TL;DR */
        .tldr-box { background: var(--gold-d); border: 1px solid var(--gold-b); border-radius: 10px; padding: 11px 14px; }
        .tldr-label { display: flex; align-items: center; gap: 5px; font-size: .6rem; font-weight: 700; text-transform: uppercase; letter-spacing: .9px; color: var(--gold); margin-bottom: 6px; }
        .tldr-icon { font-size: .75rem; }
        .tldr-text { font-size: .875rem; color: var(--tx); line-height: 1.7; font-weight: 500; }

        /* Key Points */
        .kp-section { display: flex; flex-direction: column; gap: 7px; }
        .kp-label { font-size: .6rem; font-weight: 700; text-transform: uppercase; letter-spacing: .9px; color: var(--tx3); }
        .kp-list { list-style: none; display: flex; flex-direction: column; gap: 5px; }
        .kp-item { display: flex; gap: 8px; font-size: .86rem; color: var(--tx2); line-height: 1.65; }
        .kp-bullet { color: var(--gold); flex-shrink: 0; margin-top: 3px; font-size: .68rem; }

        .detail-text p, .raw-text p { font-size: .875rem; color: var(--tx); line-height: 1.75; margin-bottom: 6px; }
        .detail-text p:last-child, .raw-text p:last-child { margin-bottom: 0; }

        /* Sources */
        .sources-section { border-top: 1px solid var(--bd); padding-top: 12px; display: flex; flex-direction: column; gap: 6px; }
        .sources-label { font-size: .6rem; font-weight: 700; text-transform: uppercase; letter-spacing: .9px; color: var(--tx3); }
        .sources-list { display: flex; flex-direction: column; gap: 4px; }
        .src-pill { background: var(--s3); border: 1px solid var(--bd); border-radius: 8px; cursor: pointer; transition: border-color .15s; }
        .src-pill:hover, .src-open { border-color: var(--bd2); }
        .src-head { display: flex; align-items: center; gap: 8px; padding: 7px 10px; }
        .src-idx { font-family: var(--mono); font-size: .63rem; color: var(--gold); font-weight: 500; flex-shrink: 0; }
        .src-name { font-size: .7rem; color: var(--tx2); font-weight: 500; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .src-page { font-family: var(--mono); font-size: .63rem; color: var(--tx3); flex-shrink: 0; }
        .src-bar-wrap { width: 40px; height: 3px; background: var(--bd2); border-radius: 2px; overflow: hidden; flex-shrink: 0; }
        .src-bar-fill { height: 100%; background: var(--gold); border-radius: 2px; }
        .src-pct { font-family: var(--mono); font-size: .6rem; color: var(--tx3); flex-shrink: 0; width: 26px; text-align: right; }
        .src-caret { font-size: .7rem; color: var(--tx3); flex-shrink: 0; }
        .src-preview { padding: 8px 10px 10px; font-size: .76rem; color: var(--tx3); line-height: 1.65; border-top: 1px solid var(--bd); }

        /* Confidence */
        .conf-wrap { display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--bd); padding-top: 10px; }
        .conf-label { font-size: .6rem; color: var(--tx3); flex-shrink: 0; text-transform: uppercase; letter-spacing: .5px; }
        .conf-track { flex: 1; height: 3px; background: var(--bd2); border-radius: 2px; overflow: hidden; }
        .conf-fill { height: 100%; border-radius: 2px; transition: width .5s; }
        .conf-hi { background: var(--green); } .conf-mid { background: var(--gold); } .conf-lo { background: var(--red); }
        .conf-pct { font-family: var(--mono); font-size: .6rem; color: var(--tx3); flex-shrink: 0; width: 30px; text-align: right; }

        /* Follow-up */
        .followup-row { display: flex; flex-wrap: wrap; gap: 6px; border-top: 1px solid var(--bd); padding-top: 10px; }
        .followup-btn { padding: 4px 10px; background: transparent; border: 1px solid var(--bd2); border-radius: 6px; color: var(--tx3); font-size: .68rem; transition: all .15s; }
        .followup-btn:hover { border-color: var(--gold); color: var(--gold); background: var(--gold-d); }

        /* Input */
        .input-dock { padding: 12px 28px 18px; flex-shrink: 0; background: var(--bg); }
        .input-box { display: flex; align-items: flex-end; gap: 8px; background: var(--s2); border: 1.5px solid var(--bd2); border-radius: 14px; padding: 10px 14px; transition: border-color .2s; }
        .input-box:focus-within { border-color: var(--gold); }
        .input-busy { opacity: .65; }
        .input-box textarea { flex: 1; background: transparent; border: none; outline: none; resize: none; font-size: .875rem; color: var(--tx); line-height: 1.6; max-height: 160px; }
        .input-box textarea::placeholder { color: var(--tx3); }
        .send-btn { width: 34px; height: 34px; background: var(--s3); border: 1px solid var(--bd2); border-radius: 10px; color: var(--tx3); font-size: 1rem; flex-shrink: 0; transition: all .15s; display: flex; align-items: center; justify-content: center; }
        .send-ready { background: var(--gold) !important; border-color: var(--gold) !important; color: #09090B !important; font-weight: 700 !important; }
        .send-spin { display: inline-block; animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .input-hint { font-size: .6rem; color: var(--tx3); text-align: center; margin-top: 6px; font-family: var(--mono); }

        /* ── Insights ── */
        .panel-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 10px; padding: 48px 24px; }
        .panel-empty-icon { font-size: 2.2rem; color: var(--gold); opacity: .5; margin-bottom: 4px; }
        .panel-empty h3 { font-size: 1.05rem; font-weight: 600; color: var(--tx2); }
        .panel-empty p { font-size: .82rem; color: var(--tx3); max-width: 300px; line-height: 1.75; }
        .btn-generate { padding: 10px 24px; background: var(--gold-d); border: 1px solid var(--gold-b); border-radius: 10px; color: var(--gold); font-size: .8rem; font-weight: 500; margin-top: 8px; transition: all .2s; }
        .btn-generate:hover { background: var(--gold-b); }

        .insights-loading { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; text-align: center; color: var(--tx2); }
        .pulse-ring { width: 48px; height: 48px; border: 2px solid var(--gold); border-radius: 50%; animation: pulse 1.4s ease-in-out infinite; }
        @keyframes pulse { 0%,100% { transform: scale(1); opacity: .5; } 50% { transform: scale(1.2); opacity: 1; } }
        .insights-loading p { font-size: .88rem; font-weight: 500; }
        .insights-loading span { font-size: .75rem; color: var(--tx3); }

        .insights-panel { flex: 1; overflow-y: auto; padding: 24px 28px; display: flex; flex-direction: column; gap: 14px; }
        .insights-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 4px; }
        .insights-header h2 { font-size: 1.1rem; font-weight: 600; letter-spacing: -.3px; }
        .insights-sub { font-size: .72rem; color: var(--tx3); margin-top: 3px; }
        .btn-regen { padding: 6px 12px; background: var(--s2); border: 1px solid var(--bd2); border-radius: 7px; color: var(--tx3); font-size: .7rem; transition: all .15s; flex-shrink: 0; }
        .btn-regen:hover { color: var(--gold); border-color: var(--gold); }

        .insight-card { background: var(--s2); border: 1px solid var(--bd); border-radius: 12px; padding: 16px 18px; }
        .insight-card-label { font-size: .6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--gold); margin-bottom: 10px; }
        .insight-summary-text { font-size: .875rem; color: var(--tx); line-height: 1.8; }

        .theme-grid { display: flex; flex-wrap: wrap; gap: 8px; }
        .theme-chip { display: flex; align-items: center; gap: 6px; padding: 5px 12px; background: var(--s3); border: 1px solid var(--bd2); border-radius: 20px; font-size: .75rem; color: var(--tx2); }
        .theme-dot { color: var(--gold); font-size: .65rem; }

        .facts-list { display: flex; flex-direction: column; gap: 9px; }
        .fact-row { display: flex; gap: 12px; align-items: baseline; }
        .fact-num { font-family: var(--mono); font-size: .63rem; color: var(--gold); flex-shrink: 0; width: 22px; font-weight: 500; }
        .fact-text { font-size: .83rem; color: var(--tx2); line-height: 1.65; }

        .entity-cloud { display: flex; flex-wrap: wrap; gap: 6px; }
        .entity-tag { padding: 3px 10px; background: var(--blue-d); border: 1px solid rgba(99,102,241,.2); border-radius: 5px; font-size: .72rem; color: var(--blue); }

        .questions-list { display: flex; flex-direction: column; gap: 6px; }
        .question-row { display: flex; align-items: baseline; gap: 8px; font-size: .83rem; color: var(--tx2); padding: 8px 12px; background: var(--s3); border-radius: 8px; cursor: pointer; transition: all .15s; border: 1px solid transparent; }
        .question-row:hover { border-color: var(--bd2); color: var(--tx); }
        .q-arrow { color: var(--gold); flex-shrink: 0; font-size: .7rem; }

        /* ── Sources View ── */
        .sources-view { flex: 1; overflow-y: auto; padding: 22px 28px; display: flex; flex-direction: column; gap: 14px; }
        .sv-header { display: flex; flex-direction: column; gap: 5px; }
        .sv-query { font-size: .9rem; font-weight: 500; font-style: italic; color: var(--tx2); }
        .sv-meta { font-size: .68rem; color: var(--tx3); font-family: var(--mono); }
        .pipeline-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .pipe-tag { background: var(--s2); border: 1px solid var(--bd2); border-radius: 5px; padding: 3px 9px; font-size: .65rem; font-family: var(--mono); color: var(--tx2); }
        .pipe-arrow { color: var(--tx3); font-size: .65rem; }

        .chunk-card { background: var(--s2); border: 1px solid var(--bd); border-radius: 10px; padding: 12px 14px; }
        .cc-head { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; }
        .cc-rank { font-family: var(--mono); font-size: .7rem; color: var(--gold); font-weight: 500; flex-shrink: 0; width: 20px; }
        .cc-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .cc-doc { font-size: .78rem; font-weight: 500; color: var(--tx2); }
        .cc-loc { font-size: .63rem; color: var(--tx3); font-family: var(--mono); }
        .cc-score-wrap { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .cc-bar { width: 64px; height: 3px; background: var(--bd2); border-radius: 2px; overflow: hidden; }
        .cc-bar-fill { height: 100%; background: var(--gold); }
        .cc-pct { font-family: var(--mono); font-size: .63rem; color: var(--tx3); width: 30px; text-align: right; }
        .cc-text { font-size: .78rem; color: var(--tx3); line-height: 1.68; }

        /* ── Eval ── */
        .eval-view { flex: 1; overflow-y: auto; padding: 24px 28px; display: flex; flex-direction: column; gap: 16px; }
        .eval-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        .eval-metric { background: var(--s2); border: 1px solid var(--bd); border-radius: 12px; padding: 18px 14px; text-align: center; }
        .metric-accent { border-color: var(--gold-b); background: var(--gold-d); }
        .eval-metric-val { font-size: 1.65rem; font-weight: 700; letter-spacing: -.6px; line-height: 1; }
        .metric-accent .eval-metric-val { color: var(--gold); }
        .eval-metric-label { font-size: .6rem; text-transform: uppercase; letter-spacing: .8px; color: var(--tx3); margin-top: 6px; }

        .dist-card { background: var(--s2); border: 1px solid var(--bd); border-radius: 12px; padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
        .dist-label { font-size: .6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--tx3); }
        .dist-row { display: flex; align-items: center; gap: 10px; }
        .dist-lbl { font-size: .75rem; color: var(--tx2); width: 90px; flex-shrink: 0; }
        .dist-track { flex: 1; height: 5px; background: var(--bd2); border-radius: 3px; overflow: hidden; }
        .dist-fill { height: 100%; border-radius: 3px; transition: width .6s; }
        .bar-doc { background: var(--green); } .bar-gen { background: var(--blue); } .bar-no { background: var(--red); }
        .dist-pct { font-family: var(--mono); font-size: .68rem; color: var(--tx3); width: 38px; text-align: right; }

        .log-section { display: flex; flex-direction: column; gap: 8px; }
        .log-label { font-size: .6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--tx3); }
        .log-table-wrap { background: var(--s2); border: 1px solid var(--bd); border-radius: 12px; overflow: hidden; }
        .log-table { width: 100%; border-collapse: collapse; font-size: .77rem; }
        .log-table th { text-align: left; padding: 9px 12px; font-size: .6rem; text-transform: uppercase; letter-spacing: .8px; color: var(--tx3); font-weight: 600; border-bottom: 1px solid var(--bd); background: var(--s1); }
        .log-table td { padding: 8px 12px; border-bottom: 1px solid var(--bd); color: var(--tx2); vertical-align: middle; }
        .log-table tr:last-child td { border-bottom: none; }
        .log-table tr:hover td { background: var(--s3); }
        .td-q { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .td-mono { font-family: var(--mono); font-size: .7rem; }
        .td-time { font-family: var(--mono); font-size: .65rem; color: var(--tx3); }
        .mb { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: .63rem; font-weight: 600; }
        .mb-doc { background: var(--green-d); color: var(--green); }
        .mb-gen { background: var(--blue-d); color: var(--blue); }
        .mb-no  { background: var(--red-d); color: var(--red); }
      `}</style>
    </div>
  );
}