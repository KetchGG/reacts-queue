// Firestore access using the project's service-account credentials. This goes through IAM, not
// Firestore Security Rules (those only gate the browser's unauthenticated reads), so it stays server-side.
import { createFirestoreClient } from "./firestore.js";

export function createStore({ serviceAccountJson }) {
  const fs = createFirestoreClient({ serviceAccountJson });
  const parseJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

  return {
    async recentDays(limit = 7) {
      const docs = await fs.listDocs("days", { limit });
      return docs.map((d) => ({ date: d.date, items: parseJson(d.items, []) }));
    },
    async day(date) {
      const d = await fs.getDoc(`days/${date}`);
      if (!d) return null;
      return { date: d.date, headline: d.headline || "", coverage: d.coverage || "", generated_at: d.generated_at, items: parseJson(d.items, []) };
    },
    async marksSince(date) {
      const docs = await fs.whereQuery("marks", "date", "GREATER_THAN_OR_EQUAL", date);
      return docs.map((d) => ({ date: d.date, item_id: d.item_id, state: d.state || "" }));
    },
    async extrasSince(date) {
      const docs = await fs.whereQuery("extras", "date", "GREATER_THAN_OR_EQUAL", date);
      return docs.map((d) => ({ date: d.date, url: d.url, title: d.title || "", note: d.note || "", removed: !!d.removed }));
    },
    async setting(key) {
      const d = await fs.getDoc(`settings/${encodeURIComponent(key)}`);
      return d ? parseJson(d.value, null) : null;
    },
    async putSetting(key, value) {
      await fs.patchDoc(`settings/${encodeURIComponent(key)}`, { value: JSON.stringify(value), updated_at: new Date().toISOString() });
    },
    async state(key, fallback = {}) {
      const d = await fs.getDoc(`app_state/${encodeURIComponent(key)}`);
      return d ? parseJson(d.value, fallback) : fallback;
    },
    async putState(key, value) {
      await fs.patchDoc(`app_state/${encodeURIComponent(key)}`, { value: JSON.stringify(value), updated_at: new Date().toISOString() });
    },
    async putDay(day) {
      await fs.patchDoc(`days/${day.date}`, {
        date: day.date, headline: day.headline || "", coverage: day.coverage || "",
        generated_at: day.generated_at, items: JSON.stringify(day.items || []),
      });
    },
    async pruneBefore(date) {
      for (const collection of ["days", "marks", "extras"]) {
        const docs = await fs.whereQuery(collection, "date", "LESS_THAN", date);
        await fs.batchDelete(docs.map((d) => `${collection}/${d.__id}`));
      }
    },
  };
}
