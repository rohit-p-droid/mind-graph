import { NextRequest, NextResponse } from "next/server";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { embedText, embedTextWithTokens, extractTriplets, extractTripletsWithTokens } from "@/lib/gemini";
import { runQuery } from "@/lib/neo4j";
import { deduplicateNodes } from "@/lib/graph";
import pdfParse from "pdf-parse";

export const runtime = "nodejs";
export const maxDuration = 300; // Increased timeout for large documents
export const bodyParser = false; // Disable for file uploads

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
          const formData = await req.formData();
          const file = formData.get("file") as File;

          if (!file) {
            controller.enqueue(encoder.encode(createLogMessage("error", "No file uploaded")));
            controller.close();
            return;
          }

          const documentName = file.name;
          controller.enqueue(encoder.encode(createLogMessage("info", `📄 Processing file: ${documentName}`)));

          const buffer = Buffer.from(await file.arrayBuffer());
          controller.enqueue(encoder.encode(createLogMessage("info", "📖 Parsing PDF...")));

          // 1. Parse PDF
          const pdfData = await pdfParse(buffer);
          const rawText = pdfData.text;
          controller.enqueue(
            encoder.encode(createLogMessage("success", `✓ PDF parsed (${pdfData.numpages} pages, ${rawText.length} chars)`))
          );

          // 2. Chunk
          controller.enqueue(encoder.encode(createLogMessage("info", "✂️ Chunking text...")));
          const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1024, chunkOverlap: 100 });
          const chunks = await splitter.splitText(rawText);
          controller.enqueue(encoder.encode(createLogMessage("success", `✓ Created ${chunks.length} chunks`)));

          // 3. Fetch existing nodes
          controller.enqueue(encoder.encode(createLogMessage("info", "🔍 Fetching existing nodes from graph...")));
          let existingRecords: any[] = [];
          try {
            existingRecords = await runQuery(
              "MATCH (n:Node) RETURN n.name AS name, n.embedding AS embedding"
            );
          } catch (dbErr: any) {
            controller.enqueue(
              encoder.encode(createLogMessage("error", `⚠️ Database connection warning: ${dbErr.message}`))
            );
          }
          const existingNodes: Record<string, number[]> = {};
          for (const r of existingRecords) {
            if (r.name && r.embedding) existingNodes[r.name] = r.embedding;
          }
          controller.enqueue(
            encoder.encode(createLogMessage("success", `✓ Found ${Object.keys(existingNodes).length} existing nodes`))
          );

          let totalTriplets = 0;
          let totalEmbeddings = 0;
          let totalRelations = 0;
          let totalInputTokens = 0;
          let totalOutputTokens = 0;

          // 4. Process each chunk
          controller.enqueue(encoder.encode(createLogMessage("info", "🔄 Processing chunks...")));
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const page = Math.floor((i / chunks.length) * (pdfData.numpages || 1)) + 1;

            controller.enqueue(
              encoder.encode(createLogMessage("info", `Chunk ${i + 1}/${chunks.length} (page ${page})...`))
            );

            // Extract triplets
            const { triplets, inputTokens: tripletInputTokens, outputTokens: tripletOutputTokens } = await extractTripletsWithTokens(chunk);
            totalInputTokens += tripletInputTokens;
            totalOutputTokens += tripletOutputTokens;

            if (!triplets.length) {
              controller.enqueue(encoder.encode(createLogMessage("debug", `No triplets extracted from chunk ${i + 1}`)));
              continue;
            }

            controller.enqueue(
              encoder.encode(
                createLogMessage("success", `✓ Extracted ${triplets.length} triplets from chunk ${i + 1}`, {
                  inputTokens: tripletInputTokens,
                  outputTokens: tripletOutputTokens,
                })
              )
            );

            // Build node objects with embeddings
            const newNodes: Record<string, number[]> = {};
            const nodeMetadata: Record<string, { text: string; document: string; page: number }> = {};

            for (const t of triplets) {
              for (const entityName of [t.source, t.destination]) {
                if (!newNodes[entityName] && !existingNodes[entityName]) {
                  controller.enqueue(
                    encoder.encode(createLogMessage("debug", `⚙️ Embedding entity: "${entityName}"`))
                  );
                  const { embedding, tokens: embeddingTokens } = await embedTextWithTokens(entityName);
                  newNodes[entityName] = embedding;
                  totalEmbeddings++;
                  totalInputTokens += embeddingTokens;
                  nodeMetadata[entityName] = { text: chunk, document: documentName, page };
                }
              }
            }

            // Deduplicate
            const canonicalMap = deduplicateNodes(existingNodes, newNodes);

            // Batch store triplets in Neo4j (much faster than individual queries)
            const tripletParams = triplets.map(t => ({
              srcName: canonicalMap[t.source] ?? t.source,
              dstName: canonicalMap[t.destination] ?? t.destination,
              srcMeta: nodeMetadata[t.source] ?? { text: chunk, document: documentName, page },
              dstMeta: nodeMetadata[t.destination] ?? { text: chunk, document: documentName, page },
              srcEmb: existingNodes[canonicalMap[t.source] ?? t.source] ?? newNodes[t.source],
              dstEmb: existingNodes[canonicalMap[t.destination] ?? t.destination] ?? newNodes[t.destination],
              relation: t.relation,
            }));

            if (tripletParams.length > 0) {
              try {
                // Batch write all triplets at once
                await runQuery(
                  `
                  UNWIND $triplets AS triplet
                  MERGE (s:Node {name: triplet.srcName})
                  ON CREATE SET s.text = triplet.srcMeta.text, s.document = triplet.srcMeta.document, 
                                s.page = triplet.srcMeta.page, s.embedding = triplet.srcEmb, 
                                s.uploadedAt = datetime()
                  MERGE (d:Node {name: triplet.dstName})
                  ON CREATE SET d.text = triplet.dstMeta.text, d.document = triplet.dstMeta.document, 
                                d.page = triplet.dstMeta.page, d.embedding = triplet.dstEmb, 
                                d.uploadedAt = datetime()
                  MERGE (s)-[r:RELATION {type: triplet.relation}]->(d)
                  RETURN count(r) AS relationCount
                  `,
                  { triplets: tripletParams }
                );

                totalTriplets += triplets.length;
                totalRelations += triplets.length;
                controller.enqueue(
                  encoder.encode(createLogMessage("success", `✓ Batch stored ${triplets.length} relations to graph`))
                );
              } catch (err: any) {
                controller.enqueue(
                  encoder.encode(
                    createLogMessage("error", `Failed to batch store triplets: ${err.message}`)
                  )
                );
              }
            }

            controller.enqueue(encoder.encode(createLogMessage("debug", `Stored ${triplets.length} relations to graph`)));
          }

          controller.enqueue(encoder.encode(createLogMessage("success", `✅ Ingestion complete!`)));
          
          // Verify nodes were stored
          try {
            const verifyRecords = await runQuery(
              "MATCH (n:Node {document: $doc}) RETURN count(n) AS nodeCount",
              { doc: documentName }
            );
            const verifyCount = verifyRecords[0]?.nodeCount || 0;
            controller.enqueue(
              encoder.encode(createLogMessage("debug", `✓ Verified ${verifyCount} nodes stored in database for "${documentName}"`))
            );
          } catch (verifyErr: any) {
            controller.enqueue(
              encoder.encode(createLogMessage("error", `Warning: Could not verify nodes: ${verifyErr.message}`))
            );
          }

          controller.enqueue(
            encoder.encode(
              createLogMessage("summary", "Summary", {
                document: documentName,
                totalChunks: chunks.length,
                totalTriplets,
                totalEmbeddings,
                totalRelations,
                totalInputTokens,
                totalOutputTokens,
                totalTokens: totalInputTokens + totalOutputTokens,
              })
            )
          );
          controller.close();
        } catch (err: any) {
          console.error("Ingest SSE error:", err);
          controller.enqueue(
            encoder.encode(createLogMessage("error", `❌ Error: ${err.message ?? "Ingestion failed"}`))
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

  // Regular JSON response (fallback)
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    const documentName = file.name;
    const buffer = Buffer.from(await file.arrayBuffer());

    // 1. Parse PDF
    const pdfData = await pdfParse(buffer);
    const rawText = pdfData.text;

    // 2. Chunk
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 512, chunkOverlap: 64 });
    const chunks = await splitter.splitText(rawText);

    // 3. Fetch existing node embeddings from Neo4j for deduplication
    const existingRecords = await runQuery(
      "MATCH (n:Node) RETURN n.name AS name, n.embedding AS embedding"
    );
    const existingNodes: Record<string, number[]> = {};
    for (const r of existingRecords) {
      if (r.name && r.embedding) existingNodes[r.name] = r.embedding;
    }

    let totalTriplets = 0;

    // 4. Process each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const page = Math.floor((i / chunks.length) * (pdfData.numpages || 1)) + 1;

      // Extract triplets
      const { triplets } = await extractTripletsWithTokens(chunk);
      if (!triplets.length) continue;

      // Build node objects with embeddings
      const newNodes: Record<string, number[]> = {};
      const nodeMetadata: Record<string, { text: string; document: string; page: number }> = {};

      for (const t of triplets) {
        for (const entityName of [t.source, t.destination]) {
          if (!newNodes[entityName] && !existingNodes[entityName]) {
            const { embedding } = await embedTextWithTokens(entityName);
            newNodes[entityName] = embedding;
            nodeMetadata[entityName] = { text: chunk, document: documentName, page };
          }
        }
      }

      // Deduplicate
      const canonicalMap = deduplicateNodes(existingNodes, newNodes);

      // Batch store triplets in Neo4j (much faster than individual queries)
      const tripletParams = triplets.map(t => ({
        srcName: canonicalMap[t.source] ?? t.source,
        dstName: canonicalMap[t.destination] ?? t.destination,
        srcMeta: nodeMetadata[t.source] ?? { text: chunk, document: documentName, page },
        dstMeta: nodeMetadata[t.destination] ?? { text: chunk, document: documentName, page },
        srcEmb: existingNodes[canonicalMap[t.source] ?? t.source] ?? newNodes[t.source],
        dstEmb: existingNodes[canonicalMap[t.destination] ?? t.destination] ?? newNodes[t.destination],
        relation: t.relation,
      }));

      if (tripletParams.length > 0) {
        await runQuery(
          `
          UNWIND $triplets AS triplet
          MERGE (s:Node {name: triplet.srcName})
          ON CREATE SET s.text = triplet.srcMeta.text, s.document = triplet.srcMeta.document, 
                        s.page = triplet.srcMeta.page, s.embedding = triplet.srcEmb, 
                        s.uploadedAt = datetime()
          MERGE (d:Node {name: triplet.dstName})
          ON CREATE SET d.text = triplet.dstMeta.text, d.document = triplet.dstMeta.document, 
                        d.page = triplet.dstMeta.page, d.embedding = triplet.dstEmb, 
                        d.uploadedAt = datetime()
          MERGE (s)-[r:RELATION {type: triplet.relation}]->(d)
          RETURN count(r) AS relationCount
          `,
          { triplets: tripletParams }
        );

        totalTriplets += triplets.length;
      }
    }

    return NextResponse.json({ success: true, documentName, tripletCount: totalTriplets });
  } catch (err: any) {
    console.error("Ingest error:", err);
    return NextResponse.json({ error: err.message ?? "Ingestion failed" }, { status: 500 });
  }
}
