import { NextResponse } from "next/server";
import { runQuery, ensureNeo4jConnected } from "@/lib/neo4j";

export const runtime = "nodejs";

export async function GET() {
  try {
    // Ensure Neo4j is awake before querying
    const isConnected = await ensureNeo4jConnected();
    if (!isConnected) {
      return NextResponse.json(
        { documents: [], error: "Neo4j instance is paused. Please try again in a moment." },
        { status: 503 }
      );
    }

    const records = await runQuery(
      "MATCH (n:Node) RETURN DISTINCT n.document AS document, count(n) AS nodeCount"
    );

    const documents = records
      .filter((r) => r.document)
      .map((r) => ({ name: r.document, nodeCount: Number(r.nodeCount) }));

    return NextResponse.json({ documents });
  } catch (err: any) {
    console.error("Documents error:", err);
    return NextResponse.json({ documents: [], error: err.message ?? "Failed to fetch documents" }, { status: 500 });
  }
}
