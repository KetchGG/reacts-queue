// Supabase REST (PostgREST) access with the project's secret key. Bypasses row-level security, so it stays server-side.
import { http } from "./util.js";

export function createStore({ url, key }) {
  const base = url.replace(/\/+$/, "") + "/rest/v1";
  const headers = { apikey: key, "Content-Type": "application/json" };
  // Legacy JWT keys (eyJ…) also need the Authorization header; new sb_secret_ keys must not use it.
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;

  const get = (path) => http(`${base}/${path}`, { headers });
  const upsert = (table, rows, onConflict) =>
    http(`${base}/${table}${onConflict ? `?on_conflict=${onConflict}` : ""}`, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
  const del = (path) => http(`${base}/${path}`, { method: "DELETE", headers: { ...headers, Prefer: "return=minimal" } });

  return {
    async recentDays(limit = 7) {
      return (await get(`days?select=date,items&order=date.desc&limit=${limit}`)) || [];
    },
    async day(date) {
      return ((await get(`days?select=*&date=eq.${date}`)) || [])[0] || null;
    },
    async marksSince(date) {
      return (await get(`marks?select=date,item_id,state&date=gte.${date}`)) || [];
    },
    async extrasSince(date) {
      return (await get(`extras?select=date,url,title,note,removed&date=gte.${date}`)) || [];
    },
    async setting(key) {
      return ((await get(`settings?select=value&key=eq.${encodeURIComponent(key)}`)) || [])[0]?.value ?? null;
    },
    async putSetting(key, value) {
      await upsert("settings", [{ key, value, updated_at: new Date().toISOString() }], "key");
    },
    async state(key, fallback = {}) {
      return ((await get(`app_state?select=value&key=eq.${encodeURIComponent(key)}`)) || [])[0]?.value ?? fallback;
    },
    async putState(key, value) {
      await upsert("app_state", [{ key, value, updated_at: new Date().toISOString() }], "key");
    },
    async putDay(day) {
      await upsert("days", [day], "date");
    },
    async pruneBefore(date) {
      await del(`days?date=lt.${date}`);
      await del(`marks?date=lt.${date}`);
      await del(`extras?date=lt.${date}`);
    },
  };
}
