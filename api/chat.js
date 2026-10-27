
// Vercel serverless function: POST /api/chat
// Works with any OpenAI-compatible provider.
// Environment variables: LLM_API_KEY, LLM_BASE_URL, LLM_MODEL

const BASE_URL = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const MODEL = process.env.LLM_MODEL || "gpt-4o-mini";

const SYSTEM_PROMPT = [
  "You are StarFinance AI, an assistant for researching markets, strategies and trading tools.",
  "Reply in the language the user writes in. Be concise and concrete.",
  "Trading is not connected on this site yet: never claim to have placed, prepared or cancelled an order, or to have live prices you were not given.",
  "Never give personalised investment advice or promise returns. Mention risk (leverage, liquidation, venue risk) when relevant.",
  "Never ask for private keys, seed phrases or passwords, and tell users not to share them.",
].join(" ");

const MAX_MESSAGES = 20;
const MAX_CHARS = 2000;
const WINDOW_MS = 60000;
const MAX_PER_WINDOW = 12;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

function cleanMessages(input) {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out = [];
  for (const m of input.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return null;
    if (typeof m.content !== "string" || !m.content.trim()) return null;
    out.push({ role: m.role, content: m.content.slice(0, MAX_CHARS) });
  }
  return out[out.length - 1].role === "user" ? out : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }
  if (!process.env.LLM_API_KEY) {
    return res.status(500).json({ error: "Chat is not configured on the server." });
  }

  const ip =
