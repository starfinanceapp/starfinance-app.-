// Vercel serverless function: POST /api/chat
// Works with any OpenAI-compatible provider.
// Environment variables: LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, LLM_FALLBACK_MODEL (optional)

const BASE_URL = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const MODEL = process.env.LLM_MODEL || "gpt-4o-mini";
const FALLBACK_MODEL = process.env.LLM_FALLBACK_MODEL || "";

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

// Status yang layak dicoba ulang (server sibuk / kuota / model tidak ketemu -> coba cadangan)
const SOFT_FAIL = new Set([404, 429, 500, 502, 503, 504]);
const MODELS = [MODEL, FALLBACK_MODEL].filter((m, i, a) => m && a.indexOf(m) === i);
const PER_MODEL = MODELS.length > 1 ? 2 : 3;
const TRIES = MODELS.flatMap((m) => Array(PER_MODEL).fill(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    (req.socket && req.socket.remoteAddress) ||
    "unknown";
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Please wait a minute." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = null;
    }
  }

  const messages = cleanMessages(body && body.messages);
  if (!messages) {
    return res.status(400).json({ error: "Invalid messages." });
  }

  for (let i = 0; i < TRIES.length; i++) {
    try {
      const upstream = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.LLM_API_KEY}`,
        },
        body: JSON.stringify({
          model: TRIES[i],
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
          temperature: 0.4,
          max_tokens: 600,
        }),
      });

      if (upstream.ok) {
        const data = await upstream.json();
        const reply =
          data && data.choices && data.choices[0] && data.choices[0].message
            ? data.choices[0].message.content
            : null;
        if (reply) {
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          return res.status(200).send(reply);
        }
      } else {
        const detail = await upstream.text();
        console.error("LLM error", upstream.status, TRIES[i], detail.slice(0, 500));
        if (!SOFT_FAIL.has(upstream.status)) break;
      }
    } catch (err) {
      console.error("LLM fetch failed", err);
    }
    if (i < TRIES.length - 1) await sleep(1000);
  }

  return res.status(502).json({ error: "The AI service is busy. Please try again." });
}
