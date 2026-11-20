import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));
const ALLOWED_TOPICS = new Set(["delivery", "pricing", "other"]);
const MODEL_TIMEOUT_MS = 300;

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function manualReview(response) {
  return json(response, 200, { status: "manual_review", topic: null, draft: null });
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function validateModelResult(raw) {
  let result;
  try { result = JSON.parse(raw); } catch { return null; }
  if (!result || typeof result !== "object" || Array.isArray(result) ||
      !ALLOWED_TOPICS.has(result.topic) || typeof result.draft !== "string" ||
      result.draft.trim().length === 0) return null;
  return { topic: result.topic, draft: result.draft.trim() };
}

async function classifyWithTimeout(text) {
  const controller = new AbortController();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error("AI request timed out"));
    }, MODEL_TIMEOUT_MS);
  });
  try {
    return await Promise.race([classify(text, { signal: controller.signal }), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleTriage(request, response) {
  let payload;
  try { payload = JSON.parse(await readRequestBody(request)); }
  catch { return json(response, 400, { status: "invalid_input" }); }

  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      typeof payload.text !== "string" || payload.text.trim().length === 0) {
    return json(response, 400, { status: "invalid_input" });
  }

  try {
    const result = validateModelResult(await classifyWithTimeout(payload.text));
    if (!result) return manualReview(response);
    return json(response, 200, { status: "ready", ...result });
  } catch {
    return manualReview(response);
  }
}

export function createApp() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage")
      return json(response, 404, { status: "not_found" });
    try { await handleTriage(request, response); }
    catch { if (!response.headersSent) json(response, 400, { status: "invalid_input" }); }
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, "127.0.0.1", () => console.log(`Server listening at http://127.0.0.1:${port}`));
}
