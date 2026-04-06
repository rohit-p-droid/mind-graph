import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const checks = {
    timestamp: new Date().toISOString(),
    environment: {
      nodeEnv: process.env.NODE_ENV,
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      hasGroqKey: !!process.env.GROQ_API_KEY,
      hasNeo4jUri: !!process.env.NEO4J_URI,
      hasNeo4jUsername: !!process.env.NEO4J_USERNAME,
      hasNeo4jPassword: !!process.env.NEO4J_PASSWORD,
    },
    neo4j: {
      connected: false,
      error: null as string | null,
      nodeCount: 0,
      documentCount: 0,
    },
  };

  // Test Neo4j connection
  try {
    const neo4j = require("neo4j-driver");
    const driver = neo4j.driver(
      process.env.NEO4J_URI!,
      neo4j.auth.basic(
        process.env.NEO4J_USERNAME!,
        process.env.NEO4J_PASSWORD!
      ),
      {
        connectionAcquisitionTimeout: 5000,
        maxConnectionPoolSize: 1,
      }
    );

    const session = driver.session();

    // Test connection with simple query
    const result = await session.run(
      `MATCH (n:Node) 
       RETURN count(n) AS totalNodes, 
              count(DISTINCT n.document) AS documents
       LIMIT 1`
    );

    if (result.records.length > 0) {
      const record = result.records[0];
      checks.neo4j.connected = true;
      checks.neo4j.nodeCount = record.get("totalNodes").toNumber();
      checks.neo4j.documentCount = record.get("documents").toNumber();
    }

    await session.close();
    await driver.close();
  } catch (error) {
    checks.neo4j.error =
      error instanceof Error ? error.message : "Unknown error";
  }

  // Return 200 even if checks fail (so we can see what's wrong)
  return NextResponse.json(checks, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
