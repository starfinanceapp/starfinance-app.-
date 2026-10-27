
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
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Please wait a minute." });
  }

  const messages = cleanMessages(req.body && req.body.messages);
  if (!messages) {
    return res.status(400).json({ error: "Invalid messages." });
  }

  try {
    const upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        temperature: 0.4,
        max_tokens: 600,
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("LLM error", upstream.status, detail.slice(0, 500));
      return res.status(502).json({ error: "The AI service returned an error." });
    }

    const data = await upstream.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) {
      return res.status(502).json({ error: "Empty response from the AI service." });
    }
    return res.status(200).json({ reply });
  } catch (err) {
    console.error("chat handler failed", err);
    return res.status(500).json({ error: "Something went wrong." });
  }
}
