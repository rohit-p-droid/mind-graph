import { NextRequest, NextResponse } from "next/server";
import { ensureNeo4jConnected } from "@/lib/neo4j";

export async function GET(request: NextRequest) {
  const checks = {
    timestamp: new Date().toISOString(),
    environment: {
      nodeEnv: process.env.NODE_ENV,
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      hasGroqKey: !!process.env.GROQ_API_KEY,
      neo4jConfig: {
        hasUri: !!process.env.NEO4J_URI,
        hasUsername: !!process.env.NEO4J_USERNAME,
        hasPassword: !!process.env.NEO4J_PASSWORD,
        uri: process.env.NEO4J_URI ? `${process.env.NEO4J_URI.split("://")[0]}://***` : null,
      },
    },
    neo4j: {
      connected: false,
      error: null as string | null,
      errorCode: null as string | null,
      suggestions: [] as string[],
      nodeCount: 0,
      documentCount: 0,
    },
  };

  // Ensure Neo4j instance is awake (retry if paused)
  const isAwake = await ensureNeo4jConnected();

  if (!isAwake) {
    checks.neo4j.error = "Neo4j instance is paused or unreachable";
    checks.neo4j.errorCode = "UNAVAILABLE";
    checks.neo4j.suggestions = [
      "Check NEO4J_URI is correct (neo4j+s:// format)",
      "Verify username and password are correct",
      "Check network/firewall allows outbound connection",
      "For free tier Aura: Resume instance from console",
      "Check Neo4j service status page",
    ];
    return NextResponse.json(checks, { status: 503 });
  }

  // Test Neo4j connection with simple query
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
  } catch (error: any) {
    const errorCode = error.code || error.name || "UNKNOWN";
    checks.neo4j.error =
      error instanceof Error ? error.message : "Unknown error";
    checks.neo4j.errorCode = errorCode;

    // Provide actionable suggestions based on error
    if (errorCode === "ServiceUnavailable" || error.message?.includes("routing")) {
      checks.neo4j.suggestions = [
        "Instance may be paused (free tier auto-pauses after inactivity)",
        "Check NEO4J_URI matches your database instance",
        "Verify credentials are correct",
        "Check firewall/VPC allows connection",
      ];
    } else if (error.message?.includes("Unauthorized") || errorCode === "AuthenticationFailure") {
      checks.neo4j.suggestions = [
        "NEO4J_USERNAME or NEO4J_PASSWORD is incorrect",
        "Check credentials in environment variables",
      ];
    } else if (error.message?.includes("ECONNREFUSED")) {
      checks.neo4j.suggestions = [
        "Cannot connect to server at all",
        "Check NEO4J_URI is correct",
        "Check network connectivity",
      ];
    } else {
      checks.neo4j.suggestions = [
        `Error code: ${errorCode}`,
        "Check Neo4j logs for more details",
        "Consult Neo4j documentation",
      ];
    }
  }

  // Return 200 even if checks fail (so we can see what's wrong)
  return NextResponse.json(checks, {
    status: checks.neo4j.connected ? 200 : 503,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
