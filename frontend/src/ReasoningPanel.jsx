/**
 * ReasoningPanel.jsx
 * Collapsible "How this answer was generated" panel.
 * Shows: retrieval pipeline, chunk comparison, source agreement/disagreement.
 */

import { useState } from "react";

/* ─── Source Agreement Detector ──────────────────────────────────────────── */
/**
 * Very lightweight heuristic: checks if two chunks share significant
 * content tokens (Jaccard similarity). Returns "agree" | "partial" | "conflict".
 */
function chunkRelationship(chunkA, chunkB) {
  const tokenize = t => new Set(t.toLowerCase().match(/\b[a-z]{3,}\b/g) || []);
  const a = tokenize(chunkA.text);
  const b = tokenize(chunkB.text);
  const intersection = new Set([...a].filter(t => b.has(t)));
  const union = new Set([...a, ...b]);
  const jaccard = intersection.size / union.size;

  if (jaccard > 0.25) return "agree";
  if (jaccard > 0.08) return "partial";
  return "different"; // distinct sections, not conflicting
}

const RELATION_LABEL = {
  agree:    { text: "Corroborates",    cls: "rel-agree"   },
  partial:  { text: "Partially overlaps", cls: "rel-partial" },
  different:{ text: "Distinct section", cls: "rel-diff"   },
};

/* ─── Pipeline Step Tracker ──────────────────────────────────────────────── */
function PipelineViz({ mode, numChunks, confidence, latencyMs }) {
  const steps = [
    { label: "BM25 Retrieval",   detail: `top-${numChunks} chunks`, done: true },
    { label: "IDF Scoring",      detail: `conf: ${Math.round(confidence * 100)}%`, done: true },
    { label: mode === "document" ? "Doc Prompt" : "General Prompt", detail: "structured JSON", done: true },
    { label: "Llama 3.1-8B",     detail: `${latencyMs}ms`, done: true },
    { label: "JSON Parse",       detail: "TL;DR + points", done: true },
  ];

  return (
    <div className="pipeline-viz">
      {steps.map((s, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span className="pv-step">
            <span className="pv-step-dot" />
            <span className="pv-step-label">{s.label}</span>
            <span className="pv-step-detail">{s.detail}</span>
          </span>
          {i < steps.length - 1 && <span className="pv-step-arrow">→</span>}
        </span>
      ))}
    </div>
  );
}

/* ─── Chunk Detail Card ───────────────────────────────────────────────────── */
function ChunkDetail({ chunk, idx, allChunks }) {
  const [expanded, setExpanded] = useState(false);

  // Compare with next chunk (if exists)
  const nextChunk = allChunks[idx + 1];
  const relation  = nextChunk ? chunkRelationship(chunk, nextChunk) : null;

  return (
    <div className="rp-chunk">
      <div className="rp-chunk-head">
        <div className="rp-chunk-rank">#{idx + 1}</div>
        <div className="rp-chunk-info">
          <span className="rp-chunk-src">{chunk.doc_name} — p.{chunk.page_number}</span>
          {nextChunk && relation && (
            <span className={`rp-relation ${RELATION_LABEL[relation].cls}`}>
              vs #{idx + 2}: {RELATION_LABEL[relation].text}
            </span>
          )}
        </div>
        <div className="rp-score-pill">
          <div className="rp-score-bar">
            <div className="rp-score-fill" style={{ width: `${Math.round(chunk.score * 100)}%` }} />
          </div>
          <span className="rp-score-num">{Math.round(chunk.score * 100)}%</span>
        </div>
        <button className="rp-toggle" onClick={() => setExpanded(e => !e)}>
          {expanded ? "−" : "+"}
        </button>
      </div>

      {expanded && (
        <div className="rp-chunk-body">
          <div className="rp-chunk-why">
            <span className="rp-why-label">Why selected:</span>
            BM25 keyword overlap with query. Score = {chunk.score.toFixed(3)} (normalized against top chunk).
          </div>
          <div className="rp-chunk-text">{chunk.text.slice(0, 500)}{chunk.text.length > 500 ? "…" : ""}</div>
        </div>
      )}
    </div>
  );
}

/* ─── Main ReasoningPanel ────────────────────────────────────────────────── */
export default function ReasoningPanel({ msg }) {
  const [open, setOpen] = useState(false);
  if (!msg || msg.loading || !msg.chunks?.length) return null;

  return (
    <div className="reasoning-panel">
      <button className="rp-toggle-header" onClick={() => setOpen(o => !o)}>
        <span className="rp-icon">{open ? "▾" : "▸"}</span>
        <span className="rp-title">How this was generated</span>
        <span className="rp-summary">
          {msg.chunks.length} chunks · {msg.mode} · {Math.round(msg.confidence * 100)}% confidence · {msg.latency_ms}ms
        </span>
      </button>

      {open && (
        <div className="rp-body">
          <div className="rp-section-label">Retrieval Pipeline</div>
          <PipelineViz
            mode={msg.mode}
            numChunks={msg.chunks.length}
            confidence={msg.confidence}
            latencyMs={msg.latency_ms}
          />

          <div className="rp-section-label" style={{ marginTop: 14 }}>Retrieved Chunks (scored)</div>
          <div className="rp-chunks-list">
            {msg.chunks.map((c, i) => (
              <ChunkDetail key={i} chunk={c} idx={i} allChunks={msg.chunks} />
            ))}
          </div>

          <div className="rp-note">
            ◈ BM25 scoring: keyword frequency weighted by inverse document frequency.
            Confidence = weighted term overlap between query and top chunk.
          </div>
        </div>
      )}

      <style>{`
        .reasoning-panel {
          border: 1px solid var(--bd); border-radius: 10px;
          overflow: hidden; margin-top: 4px;
        }
        .rp-toggle-header {
          width: 100%; display: flex; align-items: center; gap: 8px;
          padding: 9px 12px; background: var(--s3); border: none;
          cursor: pointer; text-align: left; transition: background .15s;
        }
        .rp-toggle-header:hover { background: var(--s4); }
        .rp-icon { color: var(--tx3); font-size: .72rem; flex-shrink: 0; }
        .rp-title { font-size: .72rem; font-weight: 600; color: var(--tx2); flex-shrink: 0; }
        .rp-summary { font-size: .65rem; color: var(--tx3); font-family: var(--mono); margin-left: auto; }
        .rp-body { padding: 12px 14px; background: var(--s2); display: flex; flex-direction: column; gap: 8px; }
        .rp-section-label { font-size: .58rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--tx3); }
        .pipeline-viz {
          display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
          background: var(--s1); border: 1px solid var(--bd); border-radius: 8px;
          padding: 9px 12px;
        }
        .pv-step { display: flex; align-items: center; gap: 5px; }
        .pv-step-dot { width: 6px; height: 6px; background: var(--gold); border-radius: 50%; flex-shrink: 0; }
        .pv-step-label { font-size: .68rem; font-weight: 500; color: var(--tx2); }
        .pv-step-detail { font-size: .6rem; color: var(--tx3); font-family: var(--mono); }
        .pv-step-arrow { color: var(--tx3); font-size: .65rem; }
        .rp-chunks-list { display: flex; flex-direction: column; gap: 5px; }
        .rp-chunk { background: var(--s1); border: 1px solid var(--bd); border-radius: 8px; overflow: hidden; }
        .rp-chunk-head { display: flex; align-items: center; gap: 9px; padding: 8px 10px; }
        .rp-chunk-rank { font-family: var(--mono); font-size: .65rem; color: var(--gold); flex-shrink: 0; width: 18px; font-weight: 500; }
        .rp-chunk-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .rp-chunk-src { font-size: .7rem; color: var(--tx2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rp-relation { font-size: .6rem; font-weight: 600; padding: 1px 6px; border-radius: 4px; }
        .rel-agree   { background: var(--green-d); color: var(--green); }
        .rel-partial { background: var(--gold-d); color: var(--gold); }
        .rel-diff    { background: var(--s3); color: var(--tx3); }
        .rp-score-pill { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .rp-score-bar { width: 50px; height: 3px; background: var(--bd2); border-radius: 2px; overflow: hidden; }
        .rp-score-fill { height: 100%; background: var(--gold); border-radius: 2px; }
        .rp-score-num { font-family: var(--mono); font-size: .62rem; color: var(--tx3); width: 28px; }
        .rp-toggle { width: 22px; height: 22px; background: var(--s3); border: 1px solid var(--bd2); border-radius: 5px; color: var(--tx3); font-size: .8rem; flex-shrink: 0; transition: all .15s; }
        .rp-toggle:hover { color: var(--gold); border-color: var(--gold); background: var(--gold-d); }
        .rp-chunk-body { border-top: 1px solid var(--bd); padding: 10px 12px; display: flex; flex-direction: column; gap: 7px; }
        .rp-chunk-why { font-size: .7rem; color: var(--tx3); }
        .rp-why-label { font-weight: 600; color: var(--tx2); margin-right: 5px; }
        .rp-chunk-text { font-size: .75rem; color: var(--tx3); line-height: 1.68; font-family: var(--mono); background: var(--s2); border-radius: 6px; padding: 8px 10px; }
        .rp-note { font-size: .62rem; color: var(--tx3); padding: 6px 10px; background: var(--s1); border-radius: 6px; border: 1px solid var(--bd); line-height: 1.6; }
      `}</style>
    </div>
  );
}
