export function cosineSim(a: number[], b: number[]): number {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}

export function deduplicateNodes(
  existingNodes: Record<string, number[]>,
  newNodes: Record<string, number[]>,
  threshold = 0.92
): Record<string, string> {
  const mapping: Record<string, string> = {};

  for (const [newName, newEmb] of Object.entries(newNodes)) {
    let bestMatch: string | null = null;
    let bestScore = 0;

    for (const [existingName, existingEmb] of Object.entries(existingNodes)) {
      const score = cosineSim(newEmb, existingEmb);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = existingName;
      }
    }

    if (bestScore >= threshold && bestMatch) {
      mapping[newName] = bestMatch;
    } else {
      mapping[newName] = newName;
      existingNodes[newName] = newEmb;
    }
  }

  return mapping;
}

export function formatGraphContext(facts: any[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const f of facts) {
    const key = `${f.src}-${f.rel1}-${f.mid}-${f.rel2}-${f.dst}`;
    if (seen.has(key)) continue;
    seen.add(key);

    lines.push(
      `Relationship: ${f.src} --[${f.rel1}]--> ${f.mid} --[${f.rel2}]--> ${f.dst}\nSource (${f.document}, page ${f.page}): ${f.srcText}`
    );
  }

  return lines.join("\n\n");
}
