import { NextResponse } from "next/server";
import { runQuery } from "@/lib/neo4j";

export const runtime = "nodejs";

export async function GET() {
  try {
    const records = await runQuery(
      "MATCH (n:Node) RETURN DISTINCT n.document AS document, count(n) AS nodeCount"
    );

    const documents = records
      .filter((r) => r.document)
      .map((r) => ({ name: r.document, nodeCount: Number(r.nodeCount) }));

    return NextResponse.json({ documents });
  } catch (err: any) {
    console.error("Documents error:", err);
    return NextResponse.json({ error: err.message ?? "Failed to fetch documents" }, { status: 500 });
  }
}
