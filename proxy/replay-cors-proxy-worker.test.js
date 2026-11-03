import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "./replay-cors-proxy-worker.js";

const env = {
  REPLAY_RELAY_URL: "https://replay-relay.murtagy.stream",
  REPLAY_RELAY_TOKEN: "test-secret-not-for-production",
};
const replayUrl = "https://replay.tsgames.ru/rv/ajax.php?a=l&params%5Bf%5D%5B%5D=2";

function requestFor(target, method = "GET") {
  const url = new URL("https://proxy.example/");
  url.searchParams.set("url", target);
  return new Request(url, { method, headers: { Origin: "https://viewer.example" } });
}

test("replay requests use authenticated relay, preserving query and CORS", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://replay-relay.murtagy.stream/replay?a=l&params%5Bf%5D%5B%5D=2");
    assert.equal(options.headers.Authorization, `Bearer ${env.REPLAY_RELAY_TOKEN}`);
    assert.equal(options.redirect, "manual");
    return Response.json({ rows: [] });
  });
  const response = await worker.fetch(requestFor(replayUrl), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { rows: [] });
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://viewer.example");
  assert.equal(fetch.mock.callCount(), 1);
});

test("legacy API path and replay detail also use fixed relay endpoint", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(new URL(url).pathname, "/replay");
    assert.equal(new URL(url).searchParams.get("a"), "gl");
    return Response.json({ json: "[]" });
  });
  const response = await worker.fetch(requestFor("https://replay.tsgames.ru/ajax.php?a=gl&params[f]=test&params[ar]=0&params[a]=3"), env);
  assert.equal(response.status, 200);
});

test("disallowed targets and duplicate or write actions never reach relay", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected upstream request"); });
  const targets = [
    "http://replay.tsgames.ru/rv/ajax.php?a=l",
    "https://127.0.0.1/rv/ajax.php?a=l",
    "https://replay.tsgames.ru.evil.example/rv/ajax.php?a=l",
    "https://replay.tsgames.ru:8443/rv/ajax.php?a=l",
    "https://user:pass@replay.tsgames.ru/rv/ajax.php?a=l",
    "https://replay.tsgames.ru/private/ajax.php?a=l",
    "https://replay.tsgames.ru/rv/ajax.php?a=delete",
    "https://replay.tsgames.ru/rv/ajax.php?a=l&a=delete",
  ];
  for (const target of targets) {
    assert.equal((await worker.fetch(requestFor(target), env)).status, 403, target);
  }
});

test("missing relay secret or untrusted relay URL fails closed", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected upstream request"); });
  for (const config of [
    { ...env, REPLAY_RELAY_TOKEN: "" },
    { ...env, REPLAY_RELAY_URL: "https://attacker.example" },
    { ...env, REPLAY_RELAY_URL: "http://replay-relay.murtagy.stream" },
    { ...env, REPLAY_RELAY_URL: "https://replay-relay.murtagy.stream/private" },
  ]) {
    const response = await worker.fetch(requestFor(replayUrl), config);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});

test("relay redirects and authorization errors become uncached gateway failures", async (t) => {
  let upstreamStatus = 302;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: upstreamStatus, headers: { Location: "https://attacker.example/" } });
  });
  for (const status of [302, 401, 403]) {
    upstreamStatus = status;
    const response = await worker.fetch(requestFor(replayUrl), env);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Location"), null);
    assert.equal((await response.text()).includes(env.REPLAY_RELAY_TOKEN), false);
  }
});

test("mission files remain direct and never receive relay secret", async (t) => {
  const missionUrl = "https://tsgames.ru/files/missions/test.chernarus.pbo";
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, missionUrl);
    assert.equal(options.headers.Authorization, undefined);
    return new Response("pbo");
  });
  assert.equal(await (await worker.fetch(requestFor(missionUrl), env)).text(), "pbo");
});

test("upstream errors are not cached", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  const response = await worker.fetch(requestFor(replayUrl), env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("non-GET methods rejected; preflight works without upstream request", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected upstream request"); });
  assert.equal((await worker.fetch(requestFor(replayUrl, "POST"), env)).status, 405);
  assert.equal((await worker.fetch(requestFor(replayUrl, "OPTIONS"), env)).status, 204);
});
