// Website settings. All of these are safe to publish: reads go straight to Firestore's public REST
// API (locked down by firestore/firestore.rules, not a secret key), and mod writes require signing
// into the shared Firebase Authentication account below — the Web API key only identifies the
// project, it isn't a secret (Firebase's own docs say so; real access control lives in the rules).
window.RQ_CONFIG = {
  firestoreProjectId: "reacts-queue",
  firebaseApiKey: "AIzaSyDCb0rcS8wCPWsGedK94G1PjpyBdAr98Rw",
  // Must exactly match the Email/Password user you create in Firebase Console → Authentication →
  // Users. It doesn't need to be a real inbox — mods never see or type this, only the password.
  modEmail: "mods@reacts-queue.local",
  refreshSeconds: 30,
};
