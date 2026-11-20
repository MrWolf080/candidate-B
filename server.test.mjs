import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./server.mjs";

let server;
let baseUrl;
before(async () => {
  server = createApp();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

async function post(body, raw = false) {
  return fetch(`${baseUrl}/api/triage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: raw ? body : JSON.stringify(body),
  });
}

test("empty, missing and non-string input return 400 invalid_input", async () => {
  for (const body of [{ text: "" }, { text: "   " }, {}, { text: 42 }, null]) {
    const response = await post(body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { status: "invalid_input" });
  }
});

test("malformed JSON returns 400 invalid_input", async () => {
  const response = await post("{broken", true);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { status: "invalid_input" });
});

test("valid model output returns topic and draft", async () => {
  const response = await post({ text: "Когда будет доставка?" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ready", topic: "delivery",
    draft: "Спасибо за обращение. Уточним детали заявки.",
  });
});

test("AI timeout, provider error and invalid outputs use manual review", async (t) => {
  for (const marker of ["[timeout]", "[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
    await t.test(marker, async () => {
      const started = Date.now();
      const response = await post({ text: `Проверка ${marker}` });
      const elapsed = Date.now() - started;
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "manual_review", topic: null, draft: null });
      if (marker === "[timeout]") assert.ok(elapsed < 900, `timeout took ${elapsed}ms`);
    });
  }
});
