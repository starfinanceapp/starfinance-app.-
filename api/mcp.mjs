import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const KEYS = (process.env.STARFINANCE_API_KEYS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function allowed(header = "") {
  const token = (/^Bearer\s+(.+)$/i.exec(header) || [])[1] || "";
  const a = Buffer.from(token);
  return KEYS.some((k) => {
    const b = Buffer.from(k);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

async function hl(body) {
  const r = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error("Hyperliquid error " + r.status);
  return r.json();
}

const text = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: "text", text: "Gagal: " + e.message }] });
const r6 = (n) => Number(n.toFixed(6));

function buildServer() {
  const server = new McpServer({ name: "starfinance", version: "0.1.0" });

  server.registerTool(
    "get_prices",
    {
      description: "Harga terbaru perpetual di Hyperliquid. Tanpa 'coins' = BTC, ETH, SOL.",
      inputSchema: { coins: z.array(z.string()).max(30).optional() },
    },
    async ({ coins }) => {
      try {
        const mids = await hl({ type: "allMids" });
        const want = (coins && coins.length ? coins : ["BTC", "ETH", "SOL"]).map((c) => c.toUpperCase());
        const prices = {};
        for (const [name, px] of Object.entries(mids)) {
          if (want.includes(name.toUpperCase())) prices[name] = Number(px);
        }
        return text(prices);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "get_funding_rates",
    {
      description: "Funding rate per jam (persen) dan open interest. Tanpa 'coins' = 10 pasar terbesar.",
      inputSchema: { coins: z.array(z.string()).max(30).optional() },
    },
    async ({ coins }) => {
      try {
        const [meta, ctxs] = await hl({ type: "metaAndAssetCtxs" });
        let rows = meta.universe.map((u, i) => ({
          coin: u.name,
          fundingPerJamPct: r6(Number(ctxs[i].funding) * 100),
          openInterestUsd: Math.round(Number(ctxs[i].openInterest) * Number(ctxs[i].markPx)),
        }));
        if (coins && coins.length) {
          const want = coins.map((c) => c.toUpperCase());
          rows = rows.filter((r) => want.includes(r.coin.toUpperCase()));
        } else {
          rows = rows.sort((a, b) => b.openInterestUsd - a.openInterestUsd).slice(0, 10);
        }
        return text(rows);
      } catch (e) {
        return fail(e);
      }
    }
  );

  return server;
}

function reply(res, status, message) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return reply(res, 405, "Method not allowed.");
  if (KEYS.length === 0) return reply(res, 500, "STARFINANCE_API_KEYS belum diisi.");
  if (!allowed(req.headers.authorization)) return reply(res, 401, "Unauthorized");

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) reply(res, 500, "Internal server error");
  }
}
