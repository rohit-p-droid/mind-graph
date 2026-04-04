import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/neo4j";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest) {
  try {
    const { documentName } = await req.json();

    if (!documentName) {
      return NextResponse.json({ error: "No document name provided" }, { status: 400 });
    }

    await runQuery(
      "MATCH (n:Node {document: $documentName}) DETACH DELETE n",
      { documentName }
    );

    return NextResponse.json({ success: true, documentName });
  } catch (err: any) {
    console.error("Delete error:", err);
    return NextResponse.json({ error: err.message ?? "Delete failed" }, { status: 500 });
  }
}
