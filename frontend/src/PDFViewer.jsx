/**
 * PDFViewer.jsx
 * Split-screen PDF viewer with text highlight, citation jump, and page nav.
 * Deps: react-pdf (pdfjs-dist wrapper)
 *   npm install react-pdf
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

// Must match installed pdfjs-dist version
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

/* ─────────────────────────────────────────────────────────────────────────────
   Highlight Engine
   Strategy: after each page renders, find the chunk text inside the text layer
   and inject a <mark> overlay. This avoids coordinate math entirely.
───────────────────────────────────────────────────────────────────────────── */

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Walks the rendered text layer DOM for a given page, finds spans whose
 * concatenated text matches (or partially matches) the chunk text, and
 * wraps them in a highlight overlay div.
 */
function injectHighlight(pageEl, chunkText, color = "rgba(245,158,11,0.28)") {
  if (!pageEl || !chunkText) return;

  // Clear old highlights
  pageEl.querySelectorAll(".dc-highlight").forEach(h => h.remove());

  const textLayer = pageEl.querySelector(".react-pdf__Page__textContent");
  if (!textLayer) return;

  const spans     = Array.from(textLayer.querySelectorAll("span[role='presentation'], span"));
  const fullText  = spans.map(s => s.textContent).join(" ");
  const needle    = chunkText.slice(0, 120).trim(); // first 120 chars is enough to locate
  const normFull  = fullText.replace(/\s+/g, " ");
  const normNeedle= needle.replace(/\s+/g, " ");

  const startIdx  = normFull.indexOf(normNeedle);
  if (startIdx === -1) return; // text not on this page

  // Find which spans cover [startIdx, startIdx + needle.length]
  let cursor = 0;
  const toWrap = [];
  for (const span of spans) {
    const len = (span.textContent + " ").length;
    const spanStart = cursor;
    const spanEnd   = cursor + len;
    if (spanEnd > startIdx && spanStart < startIdx + normNeedle.length) {
      toWrap.push(span);
    }
    cursor = spanEnd;
    if (cursor > startIdx + normNeedle.length) break;
  }

  toWrap.forEach(span => {
    const rect    = span.getBoundingClientRect();
    const parent  = textLayer.getBoundingClientRect();
    const overlay = document.createElement("div");
    overlay.className = "dc-highlight";
    overlay.style.cssText = `
      position: absolute;
      left: ${rect.left - parent.left}px;
      top: ${rect.top - parent.top}px;
      width: ${rect.width}px;
      height: ${rect.height + 2}px;
      background: ${color};
      border-radius: 2px;
      pointer-events: none;
      z-index: 2;
      mix-blend-mode: multiply;
    `;
    textLayer.style.position = "relative";
    textLayer.appendChild(overlay);
  });
}


/* ─────────────────────────────────────────────────────────────────────────────
   PDFViewer Component
───────────────────────────────────────────────────────────────────────────── */

export default function PDFViewer({ fileUrl, activeChunk, onClose }) {
  const [numPages,   setNumPages]   = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale,      setScale]      = useState(1.2);
  const [rendered,   setRendered]   = useState({}); // page → DOM el
  const containerRef = useRef(null);
  const pageRefs     = useRef({});

  /* Jump to page when activeChunk changes */
  useEffect(() => {
    if (!activeChunk) return;
    const targetPage = activeChunk.page_number;
    setPageNumber(targetPage);
    // Scroll to the page
    setTimeout(() => {
      const el = pageRefs.current[targetPage];
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, [activeChunk]);

  /* Re-inject highlights after page re-renders */
  useEffect(() => {
    if (!activeChunk) return;
    const el = pageRefs.current[activeChunk.page_number];
    if (el) injectHighlight(el, activeChunk.text);
  }, [activeChunk, rendered]);

  const onDocLoad = ({ numPages }) => setNumPages(numPages);

  const onPageRender = useCallback((pageNum, el) => {
    pageRefs.current[pageNum] = el;
    setRendered(r => ({ ...r, [pageNum]: true }));
    if (activeChunk?.page_number === pageNum) {
      injectHighlight(el, activeChunk.text);
    }
  }, [activeChunk]);

  if (!fileUrl) return null;

  return (
    <div className="pdf-viewer-panel">
      {/* Header */}
      <div className="pv-header">
        <div className="pv-controls">
          <button className="pv-btn" onClick={() => setPageNumber(p => Math.max(1, p - 1))} disabled={pageNumber <= 1}>←</button>
          <span className="pv-page-info">{pageNumber} / {numPages || "?"}</span>
          <button className="pv-btn" onClick={() => setPageNumber(p => Math.min(numPages || p, p + 1))} disabled={pageNumber >= (numPages || 1)}>→</button>
          <div className="pv-divider" />
          <button className="pv-btn" onClick={() => setScale(s => Math.max(0.6, s - 0.2))}>−</button>
          <span className="pv-zoom">{Math.round(scale * 100)}%</span>
          <button className="pv-btn" onClick={() => setScale(s => Math.min(2.5, s + 0.2))}>+</button>
        </div>
        <button className="pv-close" onClick={onClose} title="Close PDF viewer">✕</button>
      </div>

      {/* Chunk jump pills */}
      {activeChunk && (
        <div className="pv-jump-bar">
          <span className="pv-jump-icon">◈</span>
          <span className="pv-jump-text">
            Highlighted: <strong>{activeChunk.doc_name}</strong> — Page {activeChunk.page_number}, Chunk {activeChunk.chunk_index}
          </span>
        </div>
      )}

      {/* PDF */}
      <div className="pv-scroll" ref={containerRef}>
        <Document
          file={fileUrl}
          onLoadSuccess={onDocLoad}
          loading={<div className="pv-loading">Loading PDF…</div>}
          error={<div className="pv-error">Failed to load PDF.</div>}
        >
          {Array.from({ length: numPages || 0 }, (_, i) => i + 1).map(pNum => (
            <div
              key={pNum}
              ref={el => { if (el) pageRefs.current[pNum] = el; }}
              className={`pv-page-wrap ${pNum === pageNumber ? "pv-page-active" : ""}`}
            >
              <div className="pv-page-num">Page {pNum}</div>
              <Page
                pageNumber={pNum}
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={false}
                onRenderSuccess={() => {
                  const el = pageRefs.current[pNum];
                  onPageRender(pNum, el);
                }}
              />
            </div>
          ))}
        </Document>
      </div>

      <style>{`
        .pdf-viewer-panel {
          display: flex; flex-direction: column;
          background: var(--s1); border-right: 1px solid var(--bd);
          height: 100%; overflow: hidden; width: 100%;
        }
        .pv-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 14px; border-bottom: 1px solid var(--bd); flex-shrink: 0;
          background: var(--s2);
        }
        .pv-controls { display: flex; align-items: center; gap: 6px; }
        .pv-btn {
          width: 28px; height: 28px; background: var(--s3); border: 1px solid var(--bd2);
          border-radius: 6px; color: var(--tx2); font-size: .85rem; transition: all .15s;
          display: flex; align-items: center; justify-content: center;
        }
        .pv-btn:hover:not(:disabled) { background: var(--s4); color: var(--tx); }
        .pv-btn:disabled { opacity: .3; cursor: default; }
        .pv-page-info, .pv-zoom { font-size: .72rem; color: var(--tx2); font-family: var(--mono); min-width: 50px; text-align: center; }
        .pv-divider { width: 1px; height: 16px; background: var(--bd2); margin: 0 4px; }
        .pv-close { width: 28px; height: 28px; background: transparent; border: none; color: var(--tx3); font-size: .9rem; transition: color .15s; border-radius: 6px; }
        .pv-close:hover { color: var(--red); background: var(--red-d); }
        .pv-jump-bar {
          display: flex; align-items: center; gap: 7px; padding: 7px 14px;
          background: var(--gold-d); border-bottom: 1px solid var(--gold-b);
          font-size: .72rem; color: var(--gold); flex-shrink: 0;
        }
        .pv-jump-icon { font-size: .9rem; }
        .pv-jump-text { color: var(--tx2); }
        .pv-jump-text strong { color: var(--gold); }
        .pv-scroll { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 16px; background: var(--bg); }
        .pv-page-wrap { display: flex; flex-direction: column; align-items: center; gap: 4px; }
        .pv-page-num { font-size: .6rem; color: var(--tx3); font-family: var(--mono); text-transform: uppercase; letter-spacing: .5px; }
        .pv-page-active .pv-page-num { color: var(--gold); }
        .pv-page-wrap .react-pdf__Page { border-radius: 6px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.4); }
        .pv-loading, .pv-error { color: var(--tx3); font-size: .82rem; padding: 40px; text-align: center; }
      `}</style>
    </div>
  );
}
