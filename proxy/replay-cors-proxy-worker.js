export default {
  async fetch(request, env = {}) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    }

    if (request.method !== "GET") {
      return jsonError("Method is not allowed", 405, request);
    }

    try {
      const url = new URL(request.url);
      const rawTarget = url.searchParams.get("url");
      if (!rawTarget) {
        return jsonError("Missing query param: url", 400, request);
      }

      let target;
      try {
        target = new URL(rawTarget);
      } catch {
        return jsonError("Invalid target URL", 400, request);
      }

      if (target.protocol !== "https:" || target.port || target.username || target.password) {
        return jsonError("Target host is not allowed", 403, request);
      }

      const isReplayApi =
        target.hostname === "replay.tsgames.ru" &&
        ["/ajax.php", "/rv/ajax.php"].includes(target.pathname);
      const isMissionFile =
        target.hostname === "tsgames.ru" &&
        target.pathname.startsWith("/files/missions/") &&
        target.pathname.toLowerCase().endsWith(".pbo");

      if (!isReplayApi && !isMissionFile) {
        return jsonError("Target URL is not allowed", 403, request);
      }

      let upstreamUrl = target.toString();
      const upstreamHeaders = {
        "User-Agent": "arma3-map-render-replay-proxy/1.0",
        "Accept": isReplayApi ? "application/json, text/plain, */*" : "application/octet-stream, */*",
      };
      const useRelay = isReplayApi && Boolean(env.REPLAY_RELAY_URL);
      if (useRelay) {
        const actions = target.searchParams.getAll("a");
        if (actions.length !== 1 || !["l", "gl"].includes(actions[0])) {
          return jsonError("Replay action is not allowed", 403, request);
        }
        const relay = new URL(env.REPLAY_RELAY_URL);
        const validRelay =
          relay.protocol === "https:" &&
          relay.hostname === "replay-relay.murtagy.stream" &&
          !relay.port && !relay.username && !relay.password &&
          relay.pathname === "/" && !relay.search && !relay.hash;
        if (!validRelay || !env.REPLAY_RELAY_TOKEN) {
          return jsonError("Replay relay configuration is invalid", 503, request);
        }
        relay.pathname = "/replay";
        relay.search = target.search;
        upstreamUrl = relay.toString();
        upstreamHeaders.Authorization = `Bearer ${env.REPLAY_RELAY_TOKEN}`;
      }

      const upstream = await fetch(upstreamUrl, {
        method: "GET",
        headers: upstreamHeaders,
        redirect: useRelay ? "manual" : "follow",
        signal: AbortSignal.timeout(90_000),
      });
      if (useRelay && ((upstream.status >= 300 && upstream.status < 400) || [401, 403].includes(upstream.status))) {
        await upstream.body?.cancel();
        return jsonError("Replay relay unavailable", 502, request);
      }

      const body = await upstream.arrayBuffer();
      const headers = new Headers(upstream.headers);
      headers.set("Access-Control-Allow-Origin", request.headers.get("Origin") || "*");
      headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type");
      headers.set("Vary", "Origin");
      headers.set("Cache-Control", upstream.ok
        ? (isReplayApi ? "public, max-age=30" : "public, max-age=300")
        : "no-store");

      return new Response(body, {
        status: upstream.status,
        headers,
      });
    } catch (err) {
      return jsonError(`Proxy error: ${String(err)}`, 500, request);
    }
  },
};

function corsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function jsonError(message, status, request) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request),
    },
  });
}
