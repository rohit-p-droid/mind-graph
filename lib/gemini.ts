import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";

const apiKey = process.env.GEMINI_API_KEY!;
const ai = new GoogleGenAI({ apiKey });

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Rate limiting for embeddings (Google Gemini has rate limits)
let lastEmbedTime = 0;
const MIN_EMBED_DELAY_MS = 100; // Minimum 100ms between embedding requests

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function embedText(text: string): Promise<number[]> {
  const response = await ai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: text,
  });
  return response.embeddings?.[0]?.values || [];
}

export async function embedTextWithTokens(text: string, retries: number = 3): Promise<{ embedding: number[]; tokens: number }> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Rate limiting: enforce minimum delay between requests
      const timeSinceLastEmbed = Date.now() - lastEmbedTime;
      if (timeSinceLastEmbed < MIN_EMBED_DELAY_MS) {
        await delay(MIN_EMBED_DELAY_MS - timeSinceLastEmbed);
      }
      
      lastEmbedTime = Date.now();
      
      const response = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: text,
      });
      
      // Estimate tokens (roughly 1 token per 4 chars for embeddings)
      const estimatedTokens = Math.ceil(text.length / 4);
      return {
        embedding: response.embeddings?.[0]?.values || [],
        tokens: estimatedTokens,
      };
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a rate limit error (429)
      if (error.status === 429 && attempt < retries - 1) {
        const backoffMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        console.warn(`⚠️ Rate limited (429). Retrying in ${backoffMs}ms (attempt ${attempt + 1}/${retries})`);
        await delay(backoffMs);
        continue;
      }
      
      // For other errors or final attempt, throw
      throw error;
    }
  }
  
  throw lastError || new Error("embedTextWithTokens failed after retries");
}

export async function extractTriplets(chunk: string): Promise<
  { source: string; relation: string; destination: string }[]
> {
  const prompt = `Extract knowledge triplets from the following text.
Return ONLY a valid JSON array of objects with keys: "source", "relation", "destination".
No explanation, no markdown, no code blocks. Just the raw JSON array.

Text:
${chunk}`;

  const message = await groq.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: "llama-3.3-70b-versatile",
  });

  const raw = message.choices[0]?.message?.content?.trim() || "";

  try {
    // Strip any accidental markdown fences
    const clean = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return [];
  }
}

export async function extractTripletsWithTokens(chunk: string): Promise<{
  triplets: { source: string; relation: string; destination: string }[];
  inputTokens: number;
  outputTokens: number;
}> {
  const prompt = `Extract knowledge triplets from the following text.
Return ONLY a valid JSON array of objects with keys: "source", "relation", "destination".
No explanation, no markdown, no code blocks. Just the raw JSON array.

Text:
${chunk}`;

  const message = await groq.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: "llama-3.3-70b-versatile",
  });

  const raw = message.choices[0]?.message?.content?.trim() || "";
  let triplets: { source: string; relation: string; destination: string }[] = [];

  try {
    // Strip any accidental markdown fences
    const clean = raw.replace(/```json|```/g, "").trim();
    triplets = JSON.parse(clean);
  } catch {
    triplets = [];
  }

  return {
    triplets,
    inputTokens: message.usage?.prompt_tokens || 0,
    outputTokens: message.usage?.completion_tokens || 0,
  };
}

export async function answerWithContext(query: string, context: string): Promise<string> {
  const prompt = `You are a knowledge assistant. Use the following graph facts and source passages to answer the question.
Only use information present in the facts. If the answer is not there, say so clearly.

Graph Facts:
${context}

Question: ${query}`;

  const message = await groq.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: "llama-3.3-70b-versatile",
  });

  return message.choices[0]?.message?.content || "No response generated";
}

export async function answerWithContextTokens(query: string, context: string): Promise<{
  answer: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const prompt = `You are a knowledge assistant. Use the following graph facts and source passages to answer the question.
Only use information present in the facts. If the answer is not there, say so clearly.

Graph Facts:
${context}

Question: ${query}`;

  const message = await groq.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: "llama-3.3-70b-versatile",
  });

  return {
    answer: message.choices[0]?.message?.content || "No response generated",
    inputTokens: message.usage?.prompt_tokens || 0,
    outputTokens: message.usage?.completion_tokens || 0,
  };
}
