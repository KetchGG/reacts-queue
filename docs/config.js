// Website settings. Both values are safe to publish: the publishable key can only read,
// and every change goes through the mod password checked inside the database.
// Find them in Supabase → Project Settings → API Keys (use the "Publishable" key, never the secret one).
window.RQ_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT-REF.supabase.co",
  supabaseKey: "sb_publishable_REPLACE_ME",
  refreshSeconds: 30,
};
