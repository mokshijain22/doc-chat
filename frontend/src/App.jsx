import { useState, useRef, useEffect, useCallback } from "react";
import { Sidebar, ChatPanel } from "./ChatShell.jsx";
import { InsightsPanel, SourcesPanel, EvalPanel } from "./Panels.jsx";
import "./app.css";

const API = import.meta.env.VITE_API_URL || "";

function ToastStack({ toasts }) {
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast toast-${toast.type || "info"}`}>
          <span className="toast-dot" />
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [docs, setDocs] = useState({});
  const [strict, setStrict] = useState(true);
  const [eli5, setEli5] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadJobs, setUploadJobs] = useState(0);
  const [activeTab, setActiveTab] = useState("chat");
  const [insights, setInsights] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [toasts, setToasts] = useState([]);

  const messagesRef = useRef(messages);
  const docsRef = useRef(docs);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { docsRef.current = docs; }, [docs]);

  const notify = useCallback((message, type = "info") => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }, 3200);
  }, []);

  const handleUpload = useCallback(async files => {
    const seen = new Set();
    const pdfs = (Array.isArray(files) ? files : [files])
      .filter(file => {
        if (!file?.name?.toLowerCase().endsWith(".pdf") || docsRef.current[file.name] || seen.has(file.name)) {
          return false;
        }
        seen.add(file.name);
        return true;
      });
    if (!pdfs.length) {
      notify("Upload a new PDF file to index it.", "warning");
      return;
    }

    setUploadJobs(count => count + pdfs.length);
    notify(`Indexing ${pdfs.length} PDF${pdfs.length > 1 ? "s" : ""}...`, "info");
    await Promise.all(pdfs.map(async file => {
      const form = new FormData();
      form.append("file", file);
      try {
        const res = await fetch(`${API}/api/ingest`, { method: "POST", body: form });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setDocs(prev => ({ ...prev, [data.filename]: { chunks: data.chunks, size_kb: data.size_kb } }));
        notify(`${data.filename} indexed successfully.`, "success");
      } catch (e) {
        notify(`Upload failed: ${e.message}`, "error");
      } finally {
        setUploadJobs(count => Math.max(0, count - 1));
      }
    }));
  }, [notify]);

  const runQuery = useCallback(async question => {
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
          ? {
              role: "asst", content: data.answer, mode: data.mode, chunks: data.chunks || [],
              confidence: data.confidence, latency_ms: data.latency_ms, query: question, loading: false,
            }
          : m
      ));
    } catch (e) {
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1
          ? { role: "asst", content: `Error: ${e.message}`, mode: "no_context", chunks: [], loading: false, query: question }
          : m
      ));
      notify(`Query failed: ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [strict, eli5, notify]);

  const handleSend = useCallback(async question => {
    if (!Object.keys(docsRef.current).length) {
      notify("Upload a PDF first to start chatting.", "warning");
      return;
    }
    await runQuery(question);
  }, [notify, runQuery]);

  const handleRegenerate = useCallback(async question => {
    if (!question || loading) return;
    notify("Regenerating answer...", "info");
    await runQuery(question);
  }, [loading, notify, runQuery]);

  const handleAnalyze = useCallback(async () => {
    if (!Object.keys(docsRef.current).length) {
      notify("Upload a PDF before generating insights.", "warning");
      return;
    }
    setAnalyzing(true);
    setActiveTab("insights");
    try {
      const res = await fetch(`${API}/api/insights`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setInsights(data.insights);
      notify("Insights generated.", "success");
    } catch (e) {
      notify(`Analysis failed: ${e.message}`, "error");
    } finally {
      setAnalyzing(false);
    }
  }, [notify]);

  const handleClear = useCallback(async () => {
    await fetch(`${API}/api/clear`, { method: "POST" }).catch(() => {});
    setMessages([]);
    setDocs({});
    setInsights(null);
    notify("Session cleared.", "success");
  }, [notify]);

  const hasDocs = Object.keys(docs).length > 0;
  const tabs = [
    { id: "chat", label: "Chat" },
    { id: "insights", label: "Insights" },
    { id: "sources", label: "Sources" },
    { id: "eval", label: "Eval" },
  ];

  return (
    <div className="shell">
      <Sidebar
        docs={docs}
        onUpload={handleUpload}
        onClear={handleClear}
        strict={strict}
        setStrict={setStrict}
        eli5={eli5}
        setEli5={setEli5}
        uploadJobs={uploadJobs}
        onAnalyze={handleAnalyze}
        analyzing={analyzing}
      />

      <div className="main">
        <div className="tabs">
          <div className="tab-group" role="tablist" aria-label="DocChat sections">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`tab ${activeTab === tab.id ? "tab-active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                aria-selected={activeTab === tab.id}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="tabs-right">
            {hasDocs && (
              <span className="doc-indicator">
                <span className="status-dot" /> {Object.keys(docs).length} doc{Object.keys(docs).length > 1 ? "s" : ""} indexed
              </span>
            )}
          </div>
        </div>

        <div className="tab-body">
          {activeTab === "chat" && (
            <ChatPanel
              messages={messages}
              loading={loading}
              onSend={handleSend}
              onRegenerate={handleRegenerate}
              onToast={notify}
              hasDocs={hasDocs}
            />
          )}
          {activeTab === "insights" && (
            <InsightsPanel insights={insights} loading={analyzing} hasDocs={hasDocs} onGenerate={handleAnalyze} />
          )}
          {activeTab === "sources" && <SourcesPanel messages={messages} />}
          {activeTab === "eval" && <EvalPanel />}
        </div>
      </div>
      <ToastStack toasts={toasts} />
    </div>
  );
}
