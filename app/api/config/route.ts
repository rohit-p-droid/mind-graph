import { NextRequest, NextResponse } from "next/server";

/**
 * Diagnostic endpoint to check Neo4j configuration
 * Shows masked values for security
 */
export async function GET(request: NextRequest) {
  const config = {
    neo4j: {
      uri: process.env.NEO4J_URI || "NOT SET",
      uriMasked: process.env.NEO4J_URI 
        ? `${process.env.NEO4J_URI.split("://")[0]}://${process.env.NEO4J_URI.split("://")[1]?.split("@")[1] || "***"}` 
        : "NOT SET",
      username: process.env.NEO4J_USERNAME ? "SET (***)" : "NOT SET",
      password: process.env.NEO4J_PASSWORD ? "SET (***)" : "NOT SET",
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY ? "SET (***)" : "NOT SET",
    },
    groq: {
      apiKey: process.env.GROQ_API_KEY ? "SET (***)" : "NOT SET",
    },
  };

  // Provide troubleshooting tips based on config
  const issues: string[] = [];

  if (!process.env.NEO4J_URI) {
    issues.push("❌ NEO4J_URI is not set");
  } else if (!process.env.NEO4J_URI.match(/^neo4j(\+s)?:\/\/.+/)) {
    issues.push("❌ NEO4J_URI format is invalid (should be neo4j:// or neo4j+s://)");
  }

  if (!process.env.NEO4J_USERNAME) {
    issues.push("❌ NEO4J_USERNAME is not set");
  }

  if (!process.env.NEO4J_PASSWORD) {
    issues.push("❌ NEO4J_PASSWORD is not set");
  }

  if (!process.env.GEMINI_API_KEY) {
    issues.push("⚠️ GEMINI_API_KEY is not set");
  }

  if (!process.env.GROQ_API_KEY) {
    issues.push("⚠️ GROQ_API_KEY is not set");
  }

  const tips = [
    "1. Neo4j Aura free tier auto-pauses after ~3 days without activity",
    "2. Free tier has limited storage - clean up old documents",
    "3. Use neo4j+s:// for secure connections (recommended)",
    "4. Check username/password don't contain special characters that need encoding",
    "5. For connection errors, test the URI directly in Neo4j Browser",
  ];

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    config,
    issues: issues.length > 0 ? issues : ["✅ All configurations appear set"],
    troubleshootingTips: tips,
  });
}
