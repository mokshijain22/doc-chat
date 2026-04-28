import { useState, useRef, useEffect } from "react";

function parseStructured(raw) {
  if (!raw) return null;
  try {
    const clean = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    const obj = JSON.parse(clean);
    if (obj.summary !== undefined || obj.detailed_answer !== undefined) return obj;
  } catch (_) {}
  return null;
}

function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split("\n");
  const nodes = [];
  let list = [];

  const inline = value => {
    const parts = value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
    return parts.map((part, idx) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={idx}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`") && part.endsWith("`")) return <code key={idx}>{part.slice(1, -1)}</code>;
      return <span key={idx}>{part}</span>;
    });
  };

  const flushList = () => {
    if (!list.length) return;
    nodes.push(
      <ul key={`ul-${nodes.length}`}>
        {list.map((item, i) => <li key={i}>{inline(item)}</li>)}
      </ul>
    );
    list = [];
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      list.push(bullet[1]);
      return;
    }
    flushList();
    if (/^#{1,3}\s+/.test(trimmed)) {
      nodes.push(<h4 key={i}>{inline(trimmed.replace(/^#{1,3}\s+/, ""))}</h4>);
    } else {
      nodes.push(<p key={i}>{inline(trimmed)}</p>);
    }
  });
  flushList();
  return nodes;
}

function SourcePill({ chunk, idx }) {
  const [open, setOpen] = useState(false);
  const score = Math.round((chunk.score || 0) * 100);
  return (
    <button className={`src-pill ${open ? "src-open" : ""}`} onClick={() => setOpen(o => !o)}>
      <div className="src-head">
        <span className="src-idx">#{idx + 1}</span>
        <span className="src-name">{chunk.doc_name.replace(/\.pdf$/i, "")}</span>
        <span className="src-page">p.{chunk.page_number}</span>
        <div className="src-bar-wrap"><div className="src-bar-fill" style={{ width: `${score}%` }} /></div>
        <span className="src-pct">{score}%</span>
        <span className="src-caret">{open ? "-" : "+"}</span>
      </div>
      {open && (
        <div className="src-preview">{chunk.text.slice(0, 380)}{chunk.text.length > 380 ? "..." : ""}</div>
      )}
    </button>
  );
}

function ModeBadge({ mode }) {
  const cfg = {
    document: { label: "Document", cls: "badge-doc" },
    general: { label: "General", cls: "badge-gen" },
    no_context: { label: "No Context", cls: "badge-no" },
  };
  const c = cfg[mode] || cfg.no_context;
  return <span className={`mode-badge ${c.cls}`}>{c.label}</span>;
}

function ConfBar({ value }) {
  const pct = Math.round(Math.min(1, value || 0) * 100);
  const cls = pct > 65 ? "conf-hi" : pct > 35 ? "conf-mid" : "conf-lo";
  return (
    <div className="conf-wrap">
      <span className="conf-label">Relevance</span>
      <div className="conf-track"><div className={`conf-fill ${cls}`} style={{ width: `${pct}%` }} /></div>
      <span className="conf-pct">{pct}%</span>
    </div>
  );
}

function AssistantActions({ msg, onCopy, onRegenerate }) {
  if (msg.loading) return null;
  return (
    <div className="answer-actions">
      <button className="icon-btn" onClick={() => onCopy(msg.content)} title="Copy answer" aria-label="Copy answer">
        Copy
      </button>
      <button className="icon-btn" onClick={() => onRegenerate(msg.query)} title="Regenerate answer" aria-label="Regenerate answer">
        Regenerate
      </button>
    </div>
  );
}

function AsstMessage({ msg, onFollowUp, onCopy, onRegenerate }) {
  const parsed = msg.content ? parseStructured(msg.content) : null;

  return (
    <div className="asst-wrap">
      <div className="asst-meta">
        {msg.mode && <ModeBadge mode={msg.mode} />}
        {msg.latency_ms != null && <span className="latency-chip">{msg.latency_ms}ms</span>}
        <AssistantActions msg={msg} onCopy={onCopy} onRegenerate={onRegenerate} />
      </div>

      <div className="asst-card">
        {msg.loading ? (
          <div className="loading-state">
            <div className="typing-dots"><span /><span /><span /></div>
            <div className="skeleton-wrap">
              <div className="skel skel-short" />
              <div className="skel skel-long" />
              <div className="skel skel-med" />
              <div className="skel skel-long" style={{ width: "90%" }} />
            </div>
          </div>
        ) : parsed ? (
          <>
            {parsed.summary && (
              <div className="tldr-box">
                <div className="tldr-label">Executive TL;DR</div>
                <p className="tldr-text">{parsed.summary}</p>
              </div>
            )}
            {parsed.key_points?.length > 0 && (
              <div className="kp-section">
                <div className="kp-label">Key Points</div>
                <ul className="kp-list">
                  {parsed.key_points.map((pt, i) => (
                    <li key={i} className="kp-item"><span>{pt}</span></li>
                  ))}
                </ul>
              </div>
            )}
            <div className="markdown-body">
              {renderMarkdown(parsed.detailed_answer || parsed.answer || "")}
            </div>
          </>
        ) : (
          <div className="markdown-body">{renderMarkdown(msg.content || "")}</div>
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
            <button className="followup-btn" onClick={() => onFollowUp("Explain this in more detail")}>Explain more</button>
            <button className="followup-btn" onClick={() => onFollowUp("Give me a simpler explanation")}>Simplify</button>
            <button className="followup-btn" onClick={() => onFollowUp("What are the implications of this?")}>Implications</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Sidebar({ docs, onUpload, onClear, strict, setStrict, eli5, setEli5, uploadJobs, onAnalyze, analyzing }) {
  const fileRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const uploading = uploadJobs > 0;
  const docCount = Object.keys(docs).length;

  const drop = e => {
    e.preventDefault();
    setDrag(false);
    onUpload([...e.dataTransfer.files].filter(f => f.name.toLowerCase().endsWith(".pdf")));
  };

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
          <div className="dz-icon">{uploading ? <span className="spinner" /> : "PDF"}</div>
          <div className="dz-copy">
            <div className="dz-title">{uploading ? `Indexing ${uploadJobs} file${uploadJobs > 1 ? "s" : ""}` : "Drop PDFs here"}</div>
            <div className="dz-text">{uploading ? "Preparing searchable chunks" : "or click to browse your files"}</div>
          </div>
        </div>
        <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: "none" }}
          onChange={e => { onUpload([...e.target.files]); e.target.value = ""; }} />
      </div>

      {docCount > 0 && (
        <div className="sidebar-section">
          <div className="sec-label">
            Documents <span className="doc-count">{docCount}</span>
          </div>
          <div className="doc-list">
            {Object.entries(docs).map(([name, meta]) => (
              <div key={name} className="doc-row">
                <div className="doc-icon">PDF</div>
                <div className="doc-info">
                  <div className="doc-name">{name.replace(/\.pdf$/i, "")}</div>
                  <div className="doc-meta">
                    <span className="indexed-dot" /> Indexed
                    <span>{meta.chunks} chunks</span>
                    <span>{meta.size_kb} KB</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button className="btn-analyze" onClick={onAnalyze} disabled={analyzing}>
            {analyzing ? "Analyzing..." : "Generate Insights"}
          </button>
        </div>
      )}

      <div className="sidebar-section sidebar-bottom">
        <div className="sec-label">Settings</div>
        {[
          { key: "strict", label: "Strict Mode", desc: "Answer only from documents", val: strict, set: setStrict },
          { key: "eli5", label: "ELI5 Mode", desc: "Use simpler language", val: eli5, set: setEli5 },
        ].map(({ key, label, desc, val, set }) => (
          <button key={key} className="toggle" onClick={() => set(v => !v)} aria-pressed={val}>
            <div className="toggle-info">
              <span className="toggle-name">{label}</span>
              <span className="toggle-desc">{desc}</span>
            </div>
            <span className={`toggle-track ${val ? "on" : ""}`}><span className="toggle-thumb" /></span>
          </button>
        ))}
        <button className="btn-danger" onClick={onClear}>Clear Session</button>
      </div>
    </aside>
  );
}

function ChatPanel({ messages, loading, onSend, onRegenerate, onToast, hasDocs }) {
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

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

  const copyAnswer = async text => {
    try {
      await navigator.clipboard.writeText(text || "");
      onToast?.("Answer copied.", "success");
    } catch (_) {
      onToast?.("Unable to copy answer.", "error");
    }
  };

  const SUGGESTIONS = [
    "Summarize the key findings",
    "What are the main arguments?",
    "List important numbers and facts",
    "What conclusions does the document draw?",
  ];

  return (
    <div className="chat-panel">
      <div className="chat-scroll">
        {!messages.length ? (
          <div className="empty-chat">
            <div className="empty-logo">DC</div>
            <h2 className="empty-title">Ask your documents anything</h2>
            <p className="empty-sub">Upload PDFs, then get grounded answers with citations and a clear source trail.</p>
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
                  <AsstMessage msg={msg} onFollowUp={send} onCopy={copyAnswer} onRegenerate={onRegenerate} />
                )}
              </div>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="input-dock">
        <div className={`input-box ${loading ? "input-busy" : ""}`}>
          <span className="input-leading">Ask</span>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => { setInput(e.target.value); autoResize(); }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={hasDocs ? "Ask anything about your documents..." : "Upload a PDF first to begin..."}
            rows={1}
            disabled={loading}
          />
          <button
            className={`send-btn ${input.trim() && !loading ? "send-ready" : ""}`}
            onClick={() => send()}
            disabled={!input.trim() || loading}
            aria-label="Send message"
          >
            {loading ? <span className="spinner" /> : "Send"}
          </button>
        </div>
        <div className="input-hint">Enter to send / Shift + Enter for a new line</div>
      </div>
    </div>
  );
}

export { Sidebar, ChatPanel };
