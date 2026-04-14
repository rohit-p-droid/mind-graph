"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Document {
  name: string;
  nodeCount: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: { document: string; page: number; text: string }[];
}

interface LogEntry {
  type: string;
  message: string;
  data?: any;
  timestamp: string;
}

export default function Home() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<string>("all");
  const [uploading, setUploading] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [deletingDoc, setDeletingDoc] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [queryLogs, setQueryLogs] = useState<LogEntry[]>([]);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch("/api/documents");
      const data = await res.json();
      
      // Handle 503 (paused instance) - retry after delay
      if (res.status === 503) {
        console.warn("Neo4j instance paused, retrying in 5 seconds...");
        setTimeout(() => fetchDocuments(), 5000);
        return;
      }
      
      setDocuments(data.documents ?? []);
    } catch (err) {
      console.error("Failed to fetch documents:", err);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, queryLogs]);

  async function handleUpload(file: File) {
    if (!file || file.type !== "application/pdf") {
      setUploadStatus({ type: "error", msg: "Only PDF files are supported." });
      return;
    }

    setUploading(true);
    setUploadStatus(null);
    setLogs([]);
    setShowLogs(true);
    setQueryLogs([]); // Clear query logs when starting upload

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/ingest?sse=true", { method: "POST", body: formData });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const newLogs: LogEntry[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const logEntry = JSON.parse(line.slice(6)) as LogEntry;
              newLogs.push(logEntry);
              setLogs((prev) => [...prev, logEntry]);
            } catch {}
          }
        }
      }

      // Find summary log
      const summaryLog = newLogs.find((l) => l.type === "summary");
      if (summaryLog?.data) {
        setUploadStatus({
          type: "success",
          msg: `"${summaryLog.data.document}" ingested — ${summaryLog.data.totalTriplets} triplets created.`,
        });
      }

      // Fetch documents and wait for completion
      await fetchDocuments();
      // Keep logs modal open briefly so user can see completion, then auto-close after 2 seconds
      setTimeout(() => {
        setShowLogs(false);
      }, 2000);
    } catch (err: any) {
      setUploadStatus({ type: "error", msg: err.message ?? "Upload failed." });
      setLogs((prev) => [...prev, { type: "error", message: err.message, timestamp: new Date().toISOString() }]);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(docName: string) {
    setDeletingDoc(docName);
    try {
      const res = await fetch("/api/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentName: docName }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (selectedDoc === docName) setSelectedDoc("all");
      await fetchDocuments();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setDeletingDoc(null);
    }
  }

  async function handleQuery() {
    if (!query.trim() || querying) return;

    // Check if documents exist
    if (documents.length === 0) {
      setMessages((prev) => [
        ...prev,
        { 
          role: "user", 
          content: query 
        },
        {
          role: "assistant",
          content: "📄 No documents uploaded yet. Please upload a PDF document first to start querying the knowledge graph. Once you upload a document, I'll be able to answer questions based on its content.",
        },
      ]);
      setQuery("");
      return;
    }

    const userMsg: Message = { role: "user", content: query };
    setMessages((prev) => [...prev, userMsg]);
    setQuery("");
    setQuerying(true);
    setLogs([]); // Clear upload logs when starting query
    setQueryLogs([]);
    setShowLogs(true);

    try {
      const res = await fetch("/api/query?sse=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, documentName: selectedDoc === "all" ? undefined : selectedDoc }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      let sources: any[] = [];
      const newLogs: LogEntry[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const logEntry = JSON.parse(line.slice(6)) as LogEntry;
              newLogs.push(logEntry);
              setQueryLogs((prev) => [...prev, logEntry]);

              // Extract answer and sources from summary log
              if (logEntry.type === "summary" && logEntry.data) {
                answer = logEntry.data.answer;
                sources = logEntry.data.sources;
              }
            } catch {}
          }
        }
      }

      // Add assistant message with answer and sources
      const assistantMsg: Message = {
        role: "assistant",
        content: answer,
        sources: sources,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${err.message ?? "Something went wrong."}` },
      ]);
      setQueryLogs((prev) => [...prev, { type: "error", message: err.message, timestamp: new Date().toISOString() }]);
    } finally {
      setQuerying(false);
    }
  }

  return (
    <>
    <div className="app-grid">
        {/* Header */}
        <header className="header">
          <span className="header-title">Mind Graph</span>
          <div className="header-icons">
            <button 
              className="header-icon-btn" 
              title="Project Information"
              onClick={() => setShowInfoModal(true)}
            >
              ?
            </button>
            <button 
              className="header-icon-btn" 
              title="Contact Information"
              onClick={() => setShowContactModal(true)}
            >
              @
            </button>
          </div>
        </header>

        {/* Sidebar */}
        <aside className="sidebar">
          {/* Upload */}
          <div className="sidebar-section">
            <div className="section-label">Upload Document</div>
            <div
              className={`drop-zone ${dragOver ? "drag-over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (f) handleUpload(f);
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="drop-zone-text">
                <strong>Drop PDF here</strong><br />or click to browse
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }}
              />
            </div>

            <button className="upload-btn" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? "⟳ Processing..." : "+ Select PDF"}
            </button>

            {uploadStatus && (
              <div className={`status-msg ${uploadStatus.type === "success" ? "status-success" : "status-error"}`}>
                {uploadStatus.msg}
              </div>
            )}
          </div>

          {/* Warning */}
          <div className="warning-box">
            ⚠ Document uploads may take time depending on file size. Start with smaller PDFs to test the system before uploading larger documents.
          </div>

          <div className="warning-box">
            ⚠ Free Neo4j Aura has limited storage. Please delete documents after you're done to free up space.
          </div>

          {isClient && (
            <div className="warning-box">
              🔧 <strong>Connection Issues?</strong> Visit <code style={{background: "#f0f0f0", padding: "2px 4px"}}>/api/health</code> or <code style={{background: "#f0f0f0", padding: "2px 4px"}}>/api/config</code> for diagnostics.
            </div>
          )}

          {/* Documents */}
          <div className="docs-header">
            <div className="section-label">Uploaded Documents</div>
            {isClient && (
              <button
                onClick={() => fetchDocuments()}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "14px",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  color: "#6a7a8a",
                }}
                title="Refresh documents list"
              >
                🔄
              </button>
            )}
          </div>

          <div className="docs-list">
            {documents.length === 0 ? (
              <div className="no-docs">No documents yet</div>
            ) : (
              documents.map((doc) => (
                <div
                  key={doc.name}
                  className={`doc-item ${selectedDoc === doc.name ? "selected" : ""}`}
                  onClick={() => setSelectedDoc(doc.name)}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="doc-name" title={doc.name}>📄 {doc.name}</div>
                    <div className="doc-meta">{doc.nodeCount} nodes</div>
                  </div>
                  <button
                    className="delete-btn"
                    title="Delete document"
                    disabled={deletingDoc === doc.name}
                    onClick={(e) => { e.stopPropagation(); handleDelete(doc.name); }}
                  >
                    {deletingDoc === doc.name ? "…" : "✕"}
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Chat Panel */}
        <main className="chat-panel">
          <div className="chat-toolbar">
            <span className="toolbar-label">Scope</span>
            <select
              className="doc-select"
              value={selectedDoc}
              onChange={(e) => setSelectedDoc(e.target.value)}
            >
              <option value="all">All Documents</option>
              {documents.map((doc) => (
                <option key={doc.name} value={doc.name}>{doc.name}</option>
              ))}
            </select>
          </div>

          <div className="chat-messages">
            {messages.length === 0 ? (
              <div className="empty-chat">
                <div className="empty-icon">⬡</div>
                <div className="empty-text">Ask your documents anything</div>
                <div className="empty-sub">Upload a PDF and start querying the knowledge graph</div>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={`msg-row ${msg.role}`}>
                  <div className={`msg-avatar ${msg.role}`}>
                    {msg.role === "user" ? "U" : "G"}
                  </div>
                  <div className="msg-content">
                    <div className={`msg-bubble ${msg.role}`}>{msg.content}</div>
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="sources-list">
                        {msg.sources.map((s, j) => (
                          <div key={j} className="source-chip">
                            {s.document} · page {s.page}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {querying && !showLogs && (
              <div className="msg-row assistant">
                <div className="msg-avatar assistant">G</div>
                <div className="thinking">
                  <div className="dot" /><div className="dot" /><div className="dot" />
                  traversing graph
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          <div className="chat-input-area">
            <textarea
              className="chat-textarea"
              placeholder="Ask a question about your documents..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleQuery(); } }}
              rows={1}
            />
            <button className="send-btn" onClick={handleQuery} disabled={querying || !query.trim()}>
              {querying ? "..." : "Send →"}
            </button>
          </div>
        </main>
      </div>

      {/* Log Modal */}
      {showLogs && (
        <div className="log-modal-overlay" onClick={() => !uploading && !querying && setShowLogs(false)}>
          <div className="log-modal" onClick={(e) => e.stopPropagation()}>
            <div className="log-modal-header">
              <span className="log-modal-title">📋 {uploading ? "Upload" : "Query"} Logs</span>
              {!uploading && !querying && (
                <button className="log-modal-close" onClick={() => setShowLogs(false)}>
                  ✕
                </button>
              )}
            </div>
            <div className="log-modal-content">
              {(uploading ? logs : queryLogs).length === 0 ? (
                <div style={{ color: "#4a4a5a" }}>Waiting for logs...</div>
              ) : (
                (uploading ? logs : queryLogs).map((log, idx) => (
                  <div key={idx} className={`log-entry ${log.type}`}>
                    <span className="log-timestamp">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span>{log.message}</span>
                    {log.data && (
                      <>
                        {log.type === "success" && (log.data.tokens || log.data.inputTokens) && (
                          <div style={{ marginTop: "8px", fontSize: "10px", color: "#6a7a8a" }}>
                            � Tokens: {log.data.tokens ?? `Input: ${log.data.inputTokens}, Output: ${log.data.outputTokens}`}
                          </div>
                        )}
                        {log.type === "success" && log.data.nodes && (
                          <div style={{ marginTop: "8px", fontSize: "10px", color: "#6a7a8a" }}>
                            {log.data.nodes.map((n: any, i: number) => (
                              <div key={i}>✓ {n.name} ({n.similarity})</div>
                            ))}
                          </div>
                        )}
                        {log.type === "summary" && log.data.answer && (
                          <div style={{ marginTop: "8px", fontSize: "11px", color: "#6a7a8a" }}>
                            📖 <strong>Answer:</strong> {log.data.answer.substring(0, 100)}...
                          </div>
                        )}
                        {log.type === "summary" && (
                          <div style={{ marginTop: "8px", fontSize: "10px", color: "#6a7a8a" }}>
                            📊 {uploading ? `Triplets: ${log.data.totalTriplets || "—"} | Embeddings: ${log.data.totalEmbeddings || "—"} | Relations: ${log.data.totalRelations || "—"}` : `Facts: ${log.data.factCount || "—"}`}
                            {log.data.totalTokens && <div>🔤 Total Tokens: {log.data.totalTokens} (Input: {log.data.totalInputTokens}, Output: {log.data.totalOutputTokens})</div>}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      )}

      {/* Info Modal */}
      {showInfoModal && (
        <div className="modal-overlay" onClick={() => setShowInfoModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>📖 Mind Graph System Information</h2>
              <button className="modal-close" onClick={() => setShowInfoModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="info-section">
                <h3>📚 About Mind Graph</h3>
                <p>Mind Graph is a <strong>Graph-based Retrieval-Augmented Generation (RAG)</strong> system that combines knowledge graphs with large language models. It's a <strong>prototype implementation</strong> designed to demonstrate hybrid RAG capabilities.</p>
                <p>This POC extracts structured knowledge from documents and organizes it as a semantic graph, enabling multi-hop reasoning and context-aware question answering.</p>
              </div>

              <div className="info-section">
                <h3>🔄 Ingestion Pipeline</h3>
                <ul>
                  <li><strong>PDF Parsing:</strong> Extract text from uploaded PDF documents</li>
                  <li><strong>Text Chunking:</strong> Split text into 1024-character chunks with 100-char overlap using RecursiveCharacterTextSplitter</li>
                  <li><strong>Triplet Extraction:</strong> Use Groq LLM (llama-3.3-70b-versatile) to extract knowledge triplets (subject-relation-object)</li>
                  <li><strong>Entity Embedding:</strong> Generate vector embeddings for entities using Google Gemini Embedding (gemini-embedding-001)</li>
                  <li><strong>Graph Storage:</strong> Store entities and relationships in Neo4j knowledge graph with vector similarity indices</li>
                </ul>
              </div>

              <div className="info-section">
                <h3>🔍 Query Pipeline</h3>
                <ul>
                  <li><strong>Query Embedding:</strong> Convert user query to vector using Gemini Embedding API</li>
                  <li><strong>Semantic Search:</strong> Find top 5 matching entities using cosine similarity on embeddings</li>
                  <li><strong>Graph Traversal:</strong> Perform 2-hop relationship traversal to find connected facts</li>
                  <li><strong>Context Formatting:</strong> Organize graph facts into structured context</li>
                  <li><strong>Answer Generation:</strong> Use Groq LLM to generate natural language answer from context</li>
                </ul>
              </div>

              <div className="info-section">
                <h3>🤖 LLM Models Used</h3>
                <table className="info-table">
                  <thead>
                    <tr>
                      <th>Purpose</th>
                      <th>Model</th>
                      <th>Provider</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Entity Embedding</td>
                      <td>gemini-embedding-001</td>
                      <td>Google Gemini</td>
                    </tr>
                    <tr>
                      <td>Triplet Extraction</td>
                      <td>llama-3.3-70b-versatile</td>
                      <td>Groq</td>
                    </tr>
                    <tr>
                      <td>Answer Generation</td>
                      <td>llama-3.3-70b-versatile</td>
                      <td>Groq</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="info-section">
                <h3>🏗️ Technology Stack</h3>
                <ul>
                  <li><strong>Frontend:</strong> Next.js 14 + React 18 + TypeScript</li>
                  <li><strong>Backend:</strong> Next.js API Routes (Node.js runtime)</li>
                  <li><strong>Graph Database:</strong> Neo4j with vector embeddings</li>
                  <li><strong>Text Processing:</strong> LangChain RecursiveCharacterTextSplitter</li>
                  <li><strong>Vector Search:</strong> Cosine similarity on Google embeddings</li>
                  <li><strong>Real-time Logs:</strong> Server-Sent Events (SSE) streaming</li>
                </ul>
              </div>

              <div className="info-section">
                <h3>📊 Features</h3>
                <ul>
                  <li>Real-time processing logs during ingestion and querying</li>
                  <li>Token usage tracking for all API calls</li>
                  <li>Document management (upload, delete)</li>
                  <li>Multi-document querying with scope selection</li>
                  <li>Source attribution for generated answers</li>
                  <li>Semantic similarity matching with percentages</li>
                  <li>Multi-hop relationship traversal visualization</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contact Modal */}
      {showContactModal && (
        <div className="modal-overlay" onClick={() => setShowContactModal(false)}>
          <div className="modal-content contact-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>📧 Contact Information</h2>
              <button className="modal-close" onClick={() => setShowContactModal(false)}>✕</button>
            </div>
            <div className="modal-body contact-body">
              {process.env.NEXT_PUBLIC_CONTACT_EMAIL && (
                <div className="contact-card">
                  <div className="contact-icon">✉️</div>
                  <div className="contact-info">
                    <h4>Email</h4>
                    <a href={`mailto:${process.env.NEXT_PUBLIC_CONTACT_EMAIL}`}>
                      {process.env.NEXT_PUBLIC_CONTACT_EMAIL}
                    </a>
                  </div>
                </div>
              )}

              {process.env.NEXT_PUBLIC_CONTACT_GITHUB && (
                <div className="contact-card">
                  <div className="contact-icon">🔗</div>
                  <div className="contact-info">
                    <h4>GitHub Repository</h4>
                    <a href={process.env.NEXT_PUBLIC_CONTACT_GITHUB} target="_blank" rel="noopener noreferrer">
                      {process.env.NEXT_PUBLIC_CONTACT_GITHUB.replace('https://', '')}
                    </a>
                  </div>
                </div>
              )}

              {process.env.NEXT_PUBLIC_CONTACT_PORTFOLIO && (
                <div className="contact-card">
                  <div className="contact-icon">🌐</div>
                  <div className="contact-info">
                    <h4>Portfolio</h4>
                    <a href={process.env.NEXT_PUBLIC_CONTACT_PORTFOLIO} target="_blank" rel="noopener noreferrer">
                      {process.env.NEXT_PUBLIC_CONTACT_PORTFOLIO.replace('https://', '')}
                    </a>
                  </div>
                </div>
              )}

              {process.env.NEXT_PUBLIC_CONTACT_LINKEDIN && (
                <div className="contact-card">
                  <div className="contact-icon">💼</div>
                  <div className="contact-info">
                    <h4>LinkedIn</h4>
                    <a href={process.env.NEXT_PUBLIC_CONTACT_LINKEDIN} target="_blank" rel="noopener noreferrer">
                      {process.env.NEXT_PUBLIC_CONTACT_LINKEDIN.replace('https://', '')}
                    </a>
                  </div>
                </div>
              )}

              <div className="contact-message">
                <p><strong>Interested in Development & Collaboration?</strong></p>
                <p>Feel free to reach out if you need:</p>
                <ul>
                  <li>🚀 Development assistance for your projects</li>
                  <li>💡 Consultation on RAG systems and LLM integration</li>
                  <li>🤝 Collaboration opportunities</li>
                  <li>❓ Questions about this Mind Graph POC implementation</li>
                </ul>
                <p>I'm open to discussing new ideas and working on interesting projects!</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
