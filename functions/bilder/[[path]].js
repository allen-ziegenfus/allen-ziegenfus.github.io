/**
 * Cloudflare Pages Function: serves /bilder/<artist>/<file> from the R2 bucket
 * bound as BILDER (Pages project → Settings → Bindings). The files are the web
 * versions the Google Cloud function makes (gcf/process.js); their names never
 * change, so they may be cached forever. Range requests are passed through, so
 * videos can be scrubbed.
 */
export async function onRequestGet({ params, request, env }) {
  const key = params.path.join("/");
  const object = await env.BILDER.get(key, { range: request.headers, onlyIf: request.headers });
  if (object === null) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");

  // A conditional request whose condition failed: R2 returns no body.
  if (!("body" in object)) return new Response(null, { status: 304, headers });

  if (object.range) {
    // R2 reports either offset/length or, for "the last n bytes", a suffix.
    const r = object.range;
    const offset = "suffix" in r ? object.size - r.suffix : r.offset ?? 0;
    const length = "suffix" in r ? r.suffix : r.length ?? object.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { headers });
}
