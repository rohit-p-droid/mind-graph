# Mind Graph POC

A single-page Graph RAG application — upload PDFs, build a knowledge graph, query with natural language.

## Stack
- **Next.js 14** (App Router) — frontend + API routes
- **Gemini Pro** (`gemini-1.5-flash` + `text-embedding-004`) — LLM + embeddings
- **Neo4j Aura** — cloud graph database
- **LangChain** — PDF chunking

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Set up Neo4j Aura
1. Go to https://neo4j.com/cloud/platform/aura-graph-database/
2. Create a free instance
3. Save your connection URI, username, and password

### 3. Configure environment variables
Copy `.env.local` and fill in your credentials:
```
GEMINI_API_KEY=your_gemini_api_key
GROQ_API_KEY=your_groq_api_key (optional)
NEO4J_URI=neo4j+s://xxxx.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_password
```

### 4. Run
```bash
npm run dev
```

Open http://localhost:3000

## Usage
1. Upload a PDF using the left panel
2. Wait for ingestion (triplets are extracted and stored in Neo4j)
3. Ask questions in the chat
4. **Delete documents when done** — Neo4j Aura free tier has limited storage

## Architecture
- `/api/ingest` — PDF → chunks → triplets (Gemini) → node embeddings → Neo4j
- `/api/query` — query embedding → vector search on nodes → 2-hop graph traversal → Gemini answer
- `/api/documents` — list stored documents
- `/api/delete` — DETACH DELETE all nodes for a document
