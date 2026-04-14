import { NextRequest, NextResponse } from "next/server";
import { embedText, embedTextWithTokens, answerWithContext, answerWithContextTokens } from "@/lib/gemini";
import { runQuery, ensureNeo4jConnected } from "@/lib/neo4j";
import { cosineSim, formatGraphContext } from "@/lib/graph";

export const runtime = "nodejs";
export const maxDuration = 60;

function createLogMessage(type: string, message: string, data?: any) {
  return `data: ${JSON.stringify({ type, message, data, timestamp: new Date().toISOString() })}\n\n`;
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const useSSE = searchParams.get("sse") === "true";

  if (useSSE) {
    // Server-Sent Events response for streaming logs
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Ensure Neo4j is awake before querying
          const isConnected = await ensureNeo4jConnected();
          if (!isConnected) {
            controller.enqueue(
              encoder.encode(
                createLogMessage("error", "❌ Neo4j instance is paused. Please try again in a moment.")
              )
            );
            controller.close();
            return;
          }

          const { query, documentName } = await req.json();

          if (!query) {
            controller.enqueue(encoder.encode(createLogMessage("error", "No query provided")));
            controller.close();
            return;
          }

          controller.enqueue(encoder.encode(createLogMessage("info", `🔍 Processing query: "${query}"`)));

          let totalInputTokens = 0;
          let totalOutputTokens = 0;

          // 1. Embed query
          controller.enqueue(encoder.encode(createLogMessage("info", "⚙️ Embedding query...")));
          const { embedding: queryEmb, tokens: embedTokens } = await embedTextWithTokens(query);
          totalInputTokens += embedTokens;
          controller.enqueue(
            encoder.encode(createLogMessage("success", "✓ Query embedded", { tokens: embedTokens }))
          );

          // 2. Fetch all nodes (filtered by document if specified)
          controller.enqueue(encoder.encode(createLogMessage("info", "📊 Fetching nodes from graph...")));
          const nodeRecords = await runQuery(
            documentName
              ? "MATCH (n:Node {document: $documentName}) RETURN n.name AS name, n.embedding AS embedding"
              : "MATCH (n:Node) RETURN n.name AS name, n.embedding AS embedding",
            documentName ? { documentName } : {}
          );

          if (!nodeRecords.length) {
            controller.enqueue(
              encoder.encode(createLogMessage("error", "No documents found in the knowledge graph."))
            );
            controller.close();
            return;
          }

          controller.enqueue(
            encoder.encode(createLogMessage("success", `✓ Fetched ${nodeRecords.length} nodes`))
          );

          // 3. Cosine similarity — top 5 nodes
          controller.enqueue(encoder.encode(createLogMessage("info", "🎯 Computing similarity scores...")));
          const scored = nodeRecords
            .filter((r) => r.name && r.embedding)
            .map((r) => ({ name: r.name, score: cosineSim(queryEmb, r.embedding) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);

          const matchedNodes = scored.map((s) => s.name);

          controller.enqueue(
            encoder.encode(
              createLogMessage("success", `✓ Found ${matchedNodes.length} matching nodes`, {
                nodes: scored.map((s) => ({ name: s.name, similarity: (s.score * 100).toFixed(1) + "%" })),
              })
            )
          );

          // 4. 2-hop traversal for each matched node
          controller.enqueue(encoder.encode(createLogMessage("info", "🔗 Traversing graph (2-hop)...")));
          const allFacts: any[] = [];
          let traversalCount = 0;

          for (const nodeName of matchedNodes) {
            controller.enqueue(encoder.encode(createLogMessage("debug", `  ➜ Traversing from: "${nodeName}"`)));
            const facts = await runQuery(
              `
              MATCH (n:Node {name: $name})-[r1]-(m)-[r2]-(o)
              RETURN n.name AS src, type(r1) AS rel1,
                     m.name AS mid, m.text AS srcText,
                     type(r2) AS rel2, o.name AS dst,
                     n.document AS document, n.page AS page
              LIMIT 20
              `,
              { name: nodeName }
            );
            traversalCount += facts.length;
            if (facts.length > 0) {
              controller.enqueue(
                encoder.encode(createLogMessage("success", `    ✓ Found ${facts.length} relationships`))
              );
            }
            allFacts.push(...facts);
          }

          if (!allFacts.length) {
            controller.enqueue(
              encoder.encode(createLogMessage("error", "Found related nodes but no connected relationships."))
            );
            controller.close();
            return;
          }

          controller.enqueue(
            encoder.encode(
              createLogMessage("success", `✓ Total relationships found: ${allFacts.length}`)
            )
          );

          // 5. Format context
          controller.enqueue(encoder.encode(createLogMessage("info", "📝 Formatting context...")));
          const context = formatGraphContext(allFacts);
          controller.enqueue(
            encoder.encode(createLogMessage("success", `✓ Context prepared (${context.length} chars)`))
          );

          // 6. Answer with Groq LLM
          controller.enqueue(encoder.encode(createLogMessage("info", "🤖 Generating answer with LLM...")));
          const { answer, inputTokens: answerInputTokens, outputTokens: answerOutputTokens } = await answerWithContextTokens(query, context);
          totalInputTokens += answerInputTokens;
          totalOutputTokens += answerOutputTokens;
          controller.enqueue(
            encoder.encode(createLogMessage("success", "✓ Answer generated", {
              inputTokens: answerInputTokens,
              outputTokens: answerOutputTokens,
            }))
          );

          // 7. Extract unique sources
          const sources = Array.from(
            new Map(
              allFacts.map((f) => [`${f.document}-${f.page}`, { document: f.document, page: f.page, text: f.srcText }])
            ).values()
          ).slice(0, 5);

          controller.enqueue(encoder.encode(createLogMessage("success", `✅ Query complete!`)));
          controller.enqueue(
            encoder.encode(
              createLogMessage("summary", "Summary", {
                answer,
                sources,
                matchedNodes: scored,
                factCount: allFacts.length,
                totalInputTokens,
                totalOutputTokens,
                totalTokens: totalInputTokens + totalOutputTokens,
              })
            )
          );
          controller.close();
        } catch (err: any) {
          console.error("Query SSE error:", err);
          controller.enqueue(
            encoder.encode(createLogMessage("error", `❌ Error: ${err.message ?? "Query failed"}`))
          );
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  // Non-SSE fallback response (for backward compatibility)
  try {
    const { query, documentName } = await req.json();

    if (!query) return NextResponse.json({ error: "No query provided" }, { status: 400 });

    const queryEmb = await embedText(query);

    const nodeRecords = await runQuery(
      documentName
        ? "MATCH (n:Node {document: $documentName}) RETURN n.name AS name, n.embedding AS embedding"
        : "MATCH (n:Node) RETURN n.name AS name, n.embedding AS embedding",
      documentName ? { documentName } : {}
    );

    if (!nodeRecords.length) {
      return NextResponse.json({ answer: "No documents found in the knowledge graph.", sources: [] });
    }

    const scored = nodeRecords
      .filter((r) => r.name && r.embedding)
      .map((r) => ({ name: r.name, score: cosineSim(queryEmb, r.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const matchedNodes = scored.map((s) => s.name);

    const allFacts: any[] = [];

    for (const nodeName of matchedNodes) {
      const facts = await runQuery(
        `
        MATCH (n:Node {name: $name})-[r1]-(m)-[r2]-(o)
        RETURN n.name AS src, type(r1) AS rel1,
               m.name AS mid, m.text AS srcText,
               type(r2) AS rel2, o.name AS dst,
               n.document AS document, n.page AS page
        LIMIT 20
        `,
        { name: nodeName }
      );
      allFacts.push(...facts);
    }

    if (!allFacts.length) {
      return NextResponse.json({
        answer: "Found related nodes but no connected relationships to answer from.",
        sources: [],
      });
    }

    const context = formatGraphContext(allFacts);
    const answer = await answerWithContext(query, context);

    const sources = Array.from(
      new Map(
        allFacts.map((f) => [`${f.document}-${f.page}`, { document: f.document, page: f.page, text: f.srcText }])
      ).values()
    ).slice(0, 5);

    return NextResponse.json({ answer, sources });
  } catch (err: any) {
    console.error("Query error:", err);
    return NextResponse.json({ error: err.message ?? "Query failed" }, { status: 500 });
  }
}
