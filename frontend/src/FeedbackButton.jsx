/**
 * FeedbackButton.jsx
 * Per-message thumbs up/down that POSTs to /api/eval/feedback.
 * Logged alongside the query for Precision@K calculation.
 */

import { useState } from "react";

const API = import.meta.env.VITE_API_URL || "";

export default function FeedbackButton({ msg }) {
  const [state, setState] = useState(null); // null | "up" | "down"
  const [sent,  setSent]  = useState(false);

  if (!msg || msg.loading || msg.mode === "no_context") return null;

  const submit = async (vote) => {
    if (sent) return;
    setState(vote);
    setSent(true);

    try {
      await fetch(`${API}/api/eval/feedback`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          query:      msg.query,
          mode:       msg.mode,
          vote,                          // "up" | "down"
          confidence: msg.confidence,
          chunk_ids:  msg.chunks?.map(c => `${c.doc_name}:${c.page_number}:${c.chunk_index}`) || [],
        }),
      });
    } catch (_) {}
  };

  return (
    <div className="feedback-row">
      <span className="fb-label">Was this helpful?</span>
      <button
        className={`fb-btn ${state === "up" ? "fb-active-up" : ""}`}
        onClick={() => submit("up")}
        disabled={sent}
        title="Helpful"
      >
        ↑
      </button>
      <button
        className={`fb-btn ${state === "down" ? "fb-active-down" : ""}`}
        onClick={() => submit("down")}
        disabled={sent}
        title="Not helpful"
      >
        ↓
      </button>
      {sent && <span className="fb-thanks">{state === "up" ? "Logged ✓" : "Noted ✓"}</span>}

      <style>{`
        .feedback-row {
          display: flex; align-items: center; gap: 6px;
          border-top: 1px solid var(--bd); padding-top: 9px; margin-top: 2px;
        }
        .fb-label { font-size: .62rem; color: var(--tx3); margin-right: 2px; }
        .fb-btn {
          width: 26px; height: 26px; background: var(--s3); border: 1px solid var(--bd2);
          border-radius: 6px; color: var(--tx3); font-size: .8rem; transition: all .15s;
          display: flex; align-items: center; justify-content: center;
        }
        .fb-btn:hover:not(:disabled) { border-color: var(--bd2); color: var(--tx2); background: var(--s4); }
        .fb-btn:disabled { cursor: default; }
        .fb-active-up   { background: var(--green-d) !important; color: var(--green) !important; border-color: var(--green) !important; }
        .fb-active-down { background: var(--red-d) !important;   color: var(--red) !important;   border-color: var(--red) !important;   }
        .fb-thanks { font-size: .6rem; color: var(--tx3); font-family: var(--mono); }
      `}</style>
    </div>
  );
}
