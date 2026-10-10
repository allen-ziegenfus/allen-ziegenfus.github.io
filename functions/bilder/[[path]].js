/**
 * Cloudflare Pages Function: liefert /bilder/<artist>/<datei> aus dem R2-Bucket,
 * der als BILDER gebunden ist (Pages-Projekt → Settings → Bindings, für
 * Production und Preview). Die Dateien sind die Webversionen, die die
 * Google-Cloud-Funktion erzeugt (gcf/process.js); ihre Namen ändern sich nie,
 * also dürfen sie für immer gecacht werden. Range-Anfragen werden durchgereicht,
 * damit man in Videos springen kann.
 */
async function ausliefern({ params, request, env }, mitInhalt) {
  const schluessel = params.path.join("/");
  const bereich = request.headers.has("range");
  const objekt = mitInhalt
    ? await env.BILDER.get(schluessel, { range: bereich ? request.headers : undefined, onlyIf: request.headers })
    : await env.BILDER.head(schluessel);
  if (objekt === null) return new Response("Not found", { status: 404 });

  const kopf = new Headers();
  objekt.writeHttpMetadata(kopf);
  kopf.set("etag", objekt.httpEtag);
  kopf.set("accept-ranges", "bytes");

  if (!mitInhalt) {
    kopf.set("content-length", String(objekt.size));
    return new Response(null, { headers: kopf });
  }
  // Eine bedingte Anfrage, deren Bedingung nicht erfüllt ist: R2 liefert keinen Inhalt.
  if (!("body" in objekt)) return new Response(null, { status: 304, headers: kopf });

  if (bereich && objekt.range) {
    // R2 meldet entweder offset/length oder, für „die letzten n Bytes“, ein suffix.
    const r = objekt.range;
    const anfang = "suffix" in r ? objekt.size - r.suffix : r.offset ?? 0;
    const laenge = "suffix" in r ? r.suffix : r.length ?? objekt.size - anfang;
    kopf.set("content-range", `bytes ${anfang}-${anfang + laenge - 1}/${objekt.size}`);
    return new Response(objekt.body, { status: 206, headers: kopf });
  }
  return new Response(objekt.body, { headers: kopf });
}

export const onRequestGet = kontext => ausliefern(kontext, true);
export const onRequestHead = kontext => ausliefern(kontext, false);
