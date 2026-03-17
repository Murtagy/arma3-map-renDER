export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
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

      // Lock proxy scope to replay API only.
      if (target.protocol !== "https:" || target.hostname !== "replay.tsgames.ru") {
        return jsonError("Target host is not allowed", 403, request);
      }
      if (!target.pathname.endsWith("/ajax.php")) {
        return jsonError("Only /ajax.php is allowed", 403, request);
      }

      const upstream = await fetch(target.toString(), {
        method: "GET",
        headers: {
          "User-Agent": "arma3-map-render-replay-proxy/1.0",
          "Accept": "application/json, text/plain, */*",
        },
      });

      const body = await upstream.arrayBuffer();
      const headers = new Headers(upstream.headers);
      headers.set("Access-Control-Allow-Origin", request.headers.get("Origin") || "*");
      headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type");
      headers.set("Vary", "Origin");
      headers.set("Cache-Control", "public, max-age=30");

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
      ...corsHeaders(request),
    },
  });
}
