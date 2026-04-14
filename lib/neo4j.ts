import neo4j, { Driver } from "neo4j-driver";

let driver: Driver | null = null;

// Validate Neo4j environment variables
function validateNeo4jConfig(): { valid: boolean; message: string } {
  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME;
  const password = process.env.NEO4J_PASSWORD;

  if (!uri) return { valid: false, message: "NEO4J_URI is not set" };
  if (!username) return { valid: false, message: "NEO4J_USERNAME is not set" };
  if (!password) return { valid: false, message: "NEO4J_PASSWORD is not set" };

  // Validate URI format
  if (!uri.match(/^neo4j(\+s)?:\/\/.+/)) {
    return { valid: false, message: `Invalid NEO4J_URI format: ${uri}` };
  }

  return { valid: true, message: "Configuration valid" };
}

// Wake up paused Neo4j Aura free instance with retry
async function wakeUpNeo4j(retries = 3): Promise<void> {
  const validation = validateNeo4jConfig();
  if (!validation.valid) {
    throw new Error(`Neo4j configuration error: ${validation.message}`);
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(
        `⏳ Neo4j wake-up attempt ${attempt}/${retries}...`
      );

      const driver = getNeo4jDriver();
      const session = driver.session();
      
      try {
        // We MUST run a query to force routing discovery. 
        // driver.verifyConnectivity() is not enough as Aura proxy accepts connections before DB is ready.
        await session.run("RETURN 1 as ping");
      } finally {
        await session.close();
      }
      
      console.log(`✅ Neo4j connected successfully (attempt ${attempt})`);
      return; // Successfully woke up
    } catch (err: any) {
      const errorCode = err.code || "UNKNOWN";
      const errorMsg = err.message || "Unknown error";

      // Log detailed error info
      console.error(`❌ Attempt ${attempt} failed:`, {
        code: errorCode,
        message: errorMsg,
        uri: process.env.NEO4J_URI,
        hasAuth: !!process.env.NEO4J_USERNAME && !!process.env.NEO4J_PASSWORD,
      });

      resetNeo4jDriver();

      if (attempt < retries) {
        const backoffMs = 3000 * attempt; // 3s, 6s, 9s
        console.log(
          `Retrying in ${backoffMs}ms (${retries - attempt} attempts remaining)...`
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      } else {
        console.error(
          `❌ Neo4j wake-up failed after ${retries} attempts. Possible causes:` +
          `\n  - Instance is paused (free tier)` +
          `\n  - Connection URI is incorrect` +
          `\n  - Credentials are wrong` +
          `\n  - Network/firewall is blocking connection` +
          `\n  - Database server is down`
        );
        throw err;
      }
    }
  }
}

export function resetNeo4jDriver(): void {
  if (driver) {
    driver.close().catch(() => {});
    driver = null;
  }
}

export function getNeo4jDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      process.env.NEO4J_URI!,
      neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!),
      {
        // Timeouts
        connectionAcquisitionTimeout: 10000, // 10 seconds
        connectionTimeout: 10000,
        maxConnectionPoolSize: 5, // Limit connections on Vercel
        // Use non-interactive protocol for better performance
        disableLosslessIntegers: true,
      }
    );
  }
  return driver;
}

// Call this on app startup to ensure instance is awake
export async function ensureNeo4jConnected(): Promise<boolean> {
  try {
    await wakeUpNeo4j(3);
    console.log("✅ Neo4j instance is awake and connected");
    return true;
  } catch (err: any) {
    console.error("❌ Failed to connect to Neo4j:", err.message);
    return false;
  }
}

export async function runQuery(cypher: string, params: Record<string, any> = {}) {
  const driver = getNeo4jDriver();
  const session = driver.session();
  try {
    const result = await session.run(cypher, params);
    return result.records.map((r) => r.toObject());
  } catch (err: any) {
    const errorCode = err.code || "UNKNOWN";
    
    // Log detailed error diagnostics
    console.error("Neo4j Query Error:", {
      code: errorCode,
      message: err.message,
      cypher: cypher.substring(0, 100),
      params: Object.keys(params).slice(0, 5),
    });

    // Provide hints for common errors
    if (errorCode === "ServiceUnavailable" || err.message?.includes("routing") || err.message?.includes("discovery")) {
      console.error("💡 Hint: Neo4j instance may be unreachable. Check:");
      console.error("  - NEO4J_URI is correct and accessible");
      console.error("  - Credentials (username/password) are valid");
      console.error("  - Network/firewall allows connection");
      console.error("  - For free tier: Instance may be paused");
      resetNeo4jDriver();
    }
    
    throw err;
  } finally {
    await session.close();
  }
}
