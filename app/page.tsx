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

  // States for interactive offline warning alert
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagResults, setDiagResults] = useState<{
    database: "checking" | "active" | "inactive";
    api: "checking" | "active" | "inactive";
    envKeys: "checking" | "active" | "inactive";
  } | null>(null);

  const runDiagnostics = async () => {
    setDiagnosing(true);
    setShowDiagnostics(true);
    setDiagResults({
      database: "checking",
      api: "checking",
      envKeys: "checking",
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const res = await fetch("/api/health");
      const data = await res.json();
      
      setDiagResults((prev) => prev ? { ...prev, api: "active" } : null);
      await new Promise((resolve) => setTimeout(resolve, 600));

      const isDbConnected = data.neo4j?.connected === true;
      setDiagResults((prev) => prev ? { ...prev, database: isDbConnected ? "active" : "inactive" } : null);
      await new Promise((resolve) => setTimeout(resolve, 600));

      const hasKeys = data.environment?.hasGeminiKey && data.environment?.hasGroqKey;
      setDiagResults((prev) => prev ? { ...prev, envKeys: hasKeys ? "active" : "inactive" } : null);
    } catch (err) {
      setDiagResults({
        database: "inactive",
        api: "inactive",
        envKeys: "inactive",
      });
    } finally {
      setDiagnosing(false);
    }
  };

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
    setUploadStatus({
      type: "error",
      msg: "Action suspended: Backend server and Neo4j database are offline due to paused or unpaid hosting."
    });
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

    const userMsg: Message = { role: "user", content: query };
    setMessages((prev) => [
      ...prev,
      userMsg,
      {
        role: "assistant",
        content: "⚠️ Service Unavailable: Standard message processing and graph queries are suspended. The backend server and Neo4j database are currently paused or unpaid. Please run system diagnostics or check the instructions in the warning banner above."
      }
    ]);
    setQuery("");
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
              🔧 <strong>Connection Issues?</strong> Visit <code style={{ background: "#f0f0f0", padding: "2px 4px" }}>/api/health</code> or <code style={{ background: "#f0f0f0", padding: "2px 4px" }}>/api/config</code> for diagnostics.
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
          <div className="system-warning-banner" suppressHydrationWarning>
            <div className="warning-banner-header">
              <div className="warning-banner-title-group">
                <span className="warning-banner-icon">⚠️</span>
                <h3 className="warning-banner-title">Service Temporarily Unavailable</h3>
              </div>
            </div>
            <p className="warning-banner-desc">
              This system is temporarily unable to process messages or document uploads because the database and hosting server subscriptions are unpaid and their free tiers have been paused.
            </p>
            
            <div className="warning-banner-actions">
              <button
                className="warning-btn warning-btn-primary"
                onClick={runDiagnostics}
                disabled={diagnosing}
              >
                {diagnosing ? (
                  <span className="warning-spinner" />
                ) : (
                  <span className="warning-btn-icon">⚡</span>
                )}
                {diagnosing ? "Diagnosing Connection..." : "Run System Diagnostics"}
              </button>

              <button
                className="warning-btn warning-btn-secondary"
                onClick={() => setShowInstructions((prev) => !prev)}
              >
                <span className="warning-btn-icon">🔧</span>
                {showInstructions ? "Hide Restore Guide" : "How to Restore"}
              </button>
            </div>

            {showDiagnostics && diagResults && (
              <div className="diagnostics-panel">
                <h4 className="diagnostics-title">Diagnostic Check Results</h4>
                
                <div className="diagnostics-step">
                  <span className="diagnostics-step-label">
                    🖥️ Hosting API Server
                  </span>
                  <span className="diagnostics-step-status">
                    {diagResults.api === "checking" ? (
                      <span className="warning-spinner" />
                    ) : diagResults.api === "active" ? (
                      <>
                        <span className="status-dot status-dot-green" />
                        <span style={{ color: '#065f46', fontWeight: 600 }}>Active (Reachable)</span>
                      </>
                    ) : (
                      <>
                        <span className="status-dot status-dot-red" />
                        <span style={{ color: '#991b1b', fontWeight: 600 }}>Unreachable</span>
                      </>
                    )}
                  </span>
                </div>

                <div className="diagnostics-step">
                  <span className="diagnostics-step-label">
                    🗄️ Neo4j Graph Database
                  </span>
                  <span className="diagnostics-step-status">
                    {diagResults.database === "checking" ? (
                      <span className="warning-spinner" />
                    ) : diagResults.database === "active" ? (
                      <>
                        <span className="status-dot status-dot-green" />
                        <span style={{ color: '#065f46', fontWeight: 600 }}>Active</span>
                      </>
                    ) : (
                      <>
                        <span className="status-dot status-dot-red" />
                        <span style={{ color: '#991b1b', fontWeight: 600 }}>Offline / Paused</span>
                      </>
                    )}
                  </span>
                </div>

                <div className="diagnostics-step">
                  <span className="diagnostics-step-label">
                    🔑 LLM & Embeddings Keys
                  </span>
                  <span className="diagnostics-step-status">
                    {diagResults.envKeys === "checking" ? (
                      <span className="warning-spinner" />
                    ) : diagResults.envKeys === "active" ? (
                      <>
                        <span className="status-dot status-dot-green" />
                        <span style={{ color: '#065f46', fontWeight: 600 }}>Configured</span>
                      </>
                    ) : (
                      <>
                        <span className="status-dot status-dot-amber" />
                        <span style={{ color: '#92400e', fontWeight: 600 }}>Missing API Keys</span>
                      </>
                    )}
                  </span>
                </div>

                {!diagnosing && (diagResults.database === "inactive" || diagResults.api === "inactive") && (
                  <div className="diagnostics-summary">
                    ❌ <strong>Error:</strong> Connection to Neo4j database failed. The free tier database instance is likely paused or server hosting is suspended.
                  </div>
                )}
              </div>
            )}

            {showInstructions && (
              <div className="instructions-panel">
                <h4 className="instructions-title">Steps to Restore the System</h4>
                <ul className="instructions-list">
                  <li className="instructions-item">
                    <strong>Resume Neo4j Aura:</strong> Log into the Neo4j Aura Console and click "Resume" on your free instance, or verify database credentials in <code>.env.local</code>.
                  </li>
                  <li className="instructions-item">
                    <strong>Check API Hosting:</strong> Ensure your Next.js server has correct database connection environment variables (<code>NEO4J_URI</code>, <code>NEO4J_USERNAME</code>, <code>NEO4J_PASSWORD</code>).
                  </li>
                  <li className="instructions-item">
                    <strong>Verify API Keys:</strong> Confirm that <code>GEMINI_API_KEY</code> and <code>GROQ_API_KEY</code> are correctly set and have not expired.
                  </li>
                </ul>
              </div>
            )}
          </div>
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
                <div className="empty-icon" style={{ opacity: 0.8, color: '#d97706' }}>⚠️</div>
                <div className="empty-text" style={{ color: '#78350f' }}>System Offline</div>
                <div className="empty-sub" style={{ color: '#92400e', textAlign: 'center', maxWidth: '400px' }}>
                  The backend server and database are currently paused or unpaid. Standard queries and uploads are suspended.
                </div>
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
