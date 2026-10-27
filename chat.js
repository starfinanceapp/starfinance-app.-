// Vercel serverless function: POST /api/chat
// Works with any OpenAI-compatible provider (OpenAI, OpenRouter, Groq, DeepSeek,
// Together, Ollama, vLLM...). Configure with environment variables only:
//   LLM_API_KEY   (required)
//   LLM_BASE_URL  (default https://api.openai.com/v1)
//   LLM_MODEL     (default gpt-4o-mini)

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
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
const hits = new Map(); // best-effort only: serverless instances do not share memory

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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }
  if (!process.env.LLM_API_KEY) {
    return res.status(500).json({ error: "Chat is not configured on the server." });
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Too many messages. Wait a minute and try again." });
  }

  const messages = cleanMessages(req.body && req.body.messages);
  if (!messages) {
    return res.status(400).json({ error: "Send a list of messages that ends with a user message." });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        temperature: 0.4,
        max_tokens: 800,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      }),
    });

    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ error: "The AI provider did not respond. Try again shortly." });
    }

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });

    // Convert the provider's SSE stream into a plain text stream.
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) res.write(delta);
        } catch (_) {
          /* ignore partial JSON */
        }
      }
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(504).json({ error: "The AI provider timed out. Try again." });
    } else {
      res.end();
    }
  } finally {
    clearTimeout(timer);
  }
};
