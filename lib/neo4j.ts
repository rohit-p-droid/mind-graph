import neo4j, { Driver } from "neo4j-driver";

let driver: Driver | null = null;

export function getNeo4jDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      process.env.NEO4J_URI!,
      neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!)
    );
  }
  return driver;
}

export async function runQuery(cypher: string, params: Record<string, any> = {}) {
  const driver = getNeo4jDriver();
  const session = driver.session();
  try {
    const result = await session.run(cypher, params);
    return result.records.map((r) => r.toObject());
  } catch (err: any) {
    console.error("Neo4j Query Error:", {
      message: err.message,
      code: err.code,
      cypher: cypher.substring(0, 100),
      params: JSON.stringify(params).substring(0, 100),
    });
    throw err;
  } finally {
    await session.close();
  }
}
