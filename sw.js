// Service Worker: מאפשר לפתוח את האפליקציה גם בלי קליטה.
// דפי האפליקציה: קודם רשת (כדי לקבל עדכונים), ובלי רשת - העותק השמור.
// ספריות Firebase (כתובת עם גרסה קבועה): מהמטמון, ובפעם הראשונה מהרשת.
// נתוני Firestore עצמם נשמרים ע"י Firebase (enablePersistence) ולא כאן.
const CACHE = "atm-shell-v3";
const SHELL = ["./", "./index.html", "./manifest.json", "./terms.html", "./privacy.html"];
const FIREBASE_LIBS = [
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll([...SHELL, ...FIREBASE_LIBS]).catch(() => cache.addAll(SHELL)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // ספריות Firebase עם גרסה קבועה - מהמטמון
  if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // דפי האפליקציה עצמה (אותו מקור) - קודם רשת, ובלי רשת מהמטמון
  if (url.origin === self.location.origin) {
    // no-cache: בודקים מול השרת בכל פעם (כך גרסה חדשה מגיעה מיד ולא אחרי 10 דקות)
    event.respondWith(
      fetch(req.url, { cache: "no-cache", credentials: "same-origin" })
        .then((res) => {
          if (res.ok && (req.mode === "navigate" || /\.(html|json)$/.test(url.pathname) || url.pathname.endsWith("/"))) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true })
          .then((hit) => hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined))
          .then((hit) => hit || new Response("offline", { status: 503 })))
    );
  }
  // כל השאר (Firestore, Auth וכו') - לא נוגעים, Firebase מטפל בזה
});
