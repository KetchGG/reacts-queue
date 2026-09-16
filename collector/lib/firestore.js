// Firestore REST API client authenticated as a service account (RS256-signed JWT exchanged for a
// bearer token). No dependencies: Node's built-in crypto signs the JWT, `http()` does the rest —
// same pattern as reddit.js's client-credentials OAuth, just RS256 instead of HTTP Basic.
// Every document field in this project's schema is a plain string, a boolean, or absent, so the
// wire-format helpers below only need three branches — no arrays/maps/timestamps to encode.
import { createSign } from "node:crypto";
import { http, chunk } from "./util.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/datastore";

export function createFirestoreClient({ serviceAccountJson }) {
  const creds = typeof serviceAccountJson === "string" ? JSON.parse(serviceAccountJson) : serviceAccountJson;
  if (!creds?.project_id || !creds?.client_email || !creds?.private_key) {
    throw new Error("FIRESTORE_SERVICE_ACCOUNT is missing project_id/client_email/private_key");
  }
  const root = `https://firestore.googleapis.com/v1/projects/${creds.project_id}/databases/(default)/documents`;
  const resourceName = (pathSuffix) => `projects/${creds.project_id}/databases/(default)/documents/${pathSuffix}`;

  let token = null, expiresAt = 0;
  async function auth() {
    if (token && Date.now() < expiresAt - 30000) return token;
    const now = Math.floor(Date.now() / 1000);
    const b64url = (s) => Buffer.from(s).toString("base64url");
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(JSON.stringify({ iss: creds.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
    const sig = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(creds.private_key);
    const assertion = `${header}.${claims}.${Buffer.from(sig).toString("base64url")}`;
    const r = await http(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${assertion}`,
    });
    if (!r?.access_token) throw new Error("Firestore auth failed (check FIRESTORE_SERVICE_ACCOUNT)");
    token = r.access_token;
    expiresAt = Date.now() + (r.expires_in || 3600) * 1000;
    return token;
  }

  const call = async (path, opts = {}) => {
    const tk = await auth();
    return http(`${root}${path}`, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}), Authorization: `Bearer ${tk}` } });
  };

  return {
    /** Single document, or null if it doesn't exist. */
    async getDoc(pathSuffix) {
      try { return fromDoc(await call(`/${pathSuffix}`)); }
      catch (e) { if (e.status === 404) return null; throw e; }
    },

    /** Unfiltered list, e.g. { orderBy: "__name__", direction: "desc", limit: 8 } to get the N most recent by doc id. */
    async listDocs(collection, { orderBy = "__name__", direction = "desc", limit = 20 } = {}) {
      const qs = new URLSearchParams({ orderBy: `${orderBy} ${direction}`, pageSize: String(limit) });
      const r = await call(`/${collection}?${qs}`);
      return (r.documents || []).map(fromDoc);
    },

    /** Filtered query: runQuery(collection, "date", "GREATER_THAN_OR_EQUAL" | "LESS_THAN", value). */
    async whereQuery(collection, fieldPath, op, value) {
      const structuredQuery = {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath }, op, value: { stringValue: value } } },
      };
      const r = await call(":runQuery", { method: "POST", body: JSON.stringify({ structuredQuery }) });
      return (r || []).filter((x) => x.document).map((x) => fromDoc(x.document));
    },

    /** Upsert (create-or-merge) the given flat fields onto a document. */
    async patchDoc(pathSuffix, fields) {
      const mask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&");
      await call(`/${pathSuffix}?${mask}`, { method: "PATCH", body: JSON.stringify({ fields: toFields(fields) }) });
    },

    /** Delete documents by path ("collection/id"), 500 at a time (Firestore's batchWrite limit). */
    async batchDelete(paths) {
      for (const group of chunk(paths, 500)) {
        if (!group.length) continue;
        await call(":batchWrite", { method: "POST", body: JSON.stringify({ writes: group.map((p) => ({ delete: resourceName(p) })) }) });
      }
    },
  };
}

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  return { stringValue: String(v) };
}
function toFields(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toValue(v)]));
}
function fromValue(v) {
  if (!v || "nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("stringValue" in v) return v.stringValue;
  return null;
}
function fromDoc(doc) {
  if (!doc?.name) return null;
  const out = { __id: doc.name.split("/").pop() };
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = fromValue(v);
  return out;
}
