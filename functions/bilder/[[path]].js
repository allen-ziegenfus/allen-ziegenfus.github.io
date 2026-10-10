/**
 * Cloudflare Pages Function: serves /bilder/<artist>/<file> from the R2 bucket
 * bound as BILDER (Pages project → Settings → Bindings, for Production and
 * Preview). The files are the web versions the Google Cloud function makes
 * (gcf/process.js); their names never change, so they may be cached forever.
 * Range requests are passed through, so videos can be scrubbed.
 */
async function serve({ params, request, env }, withBody) {
  const key = params.path.join("/");
  const ranged = request.headers.has("range");
  const object = withBody
    ? await env.BILDER.get(key, { range: ranged ? request.headers : undefined, onlyIf: request.headers })
    : await env.BILDER.head(key);
  if (object === null) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");

  if (!withBody) {
    headers.set("content-length", String(object.size));
    return new Response(null, { headers });
  }
  // A conditional request whose condition failed: R2 returns no body.
  if (!("body" in object)) return new Response(null, { status: 304, headers });

  if (ranged && object.range) {
    // R2 reports either offset/length or, for "the last n bytes", a suffix.
    const r = object.range;
    const offset = "suffix" in r ? object.size - r.suffix : r.offset ?? 0;
    const length = "suffix" in r ? r.suffix : r.length ?? object.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { headers });
}

export const onRequestGet = context => serve(context, true);
export const onRequestHead = context => serve(context, false);
