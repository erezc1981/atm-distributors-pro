// אבטחה: האתר לא נטען בתוך מסגרת של אתר אחר (הגנה מהונאת לחיצות)
if (window.top !== window.self) window.top.location = window.self.location.href;

const firebaseConfig = {
  apiKey: "AIzaSyBKQfbitijJHfIGAKg9N2aNvT6BCHEYsCU",
  authDomain: "atm-distributors-pro.firebaseapp.com",
  projectId: "atm-distributors-pro",
  storageBucket: "atm-distributors-pro.firebasestorage.app",
  messagingSenderId: "431026876840",
  appId: "1:431026876840:web:619e1e27a24d3d69e92d9d"
};
// ההרשאה האמיתית נאכפת ב-firestore.rules (isAdmin); כאן רק לתצוגה
const ADMIN_UID = "TblW8UHDSBTh91BCJcqo3YKEqQJ3";
const PRICES = { monthly: 99, yearly: 890 };
const DAY = 86400000;

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let rows = [];          // [{uid, p, cas}]
let filter = "all";
let search = "";
const openPayments = new Set();
const paymentsCache = {};

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const fmtDate = (ms) => (ms ? new Date(Number(ms)).toLocaleDateString("he-IL") : "—");
const fmtDateTime = (ms) => (ms ? new Date(Number(ms)).toLocaleString("he-IL") : "—");

function statusOf(p) {
  const now = Date.now();
  if (p.plan === "owner_free") return { key: "owner", label: "בעלים (חינם)", end: null };
  const s = p.subscriptionStatus || "trial";
  if (s === "active") {
    const end = Number(p.currentPeriodEnd) || 0;
    if (end && end < now) return { key: "expired", label: "מנוי פג", end };
    return { key: "active", label: `פעיל (${p.plan === "yearly" ? "שנתי" : "חודשי"})`, end };
  }
  if (s === "canceled") return { key: "canceled", label: "בוטל", end: Number(p.currentPeriodEnd) || null };
  const end = Number(p.trialEndsAt) || 0;
  if (!end || end < now) return { key: "expired", label: "ניסיון הסתיים", end };
  return { key: "trial", label: "ניסיון", end };
}

function daysLeft(end) {
  if (!end) return null;
  return Math.ceil((Number(end) - Date.now()) / DAY);
}

function isPending(p) {
  const r = p.upgradeRequest || {};
  return Boolean(r.requestedAt) && !r.handledAt;
}

function addMonths(ms, months) {
  const d = new Date(ms);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

function renderStats() {
  const st = rows.map((r) => statusOf(r.p).key);
  document.getElementById("sTotal").textContent = rows.filter((r) => r.p.plan !== "owner_free").length;
  document.getElementById("sActive").textContent = st.filter((k) => k === "active").length;
  document.getElementById("sTrial").textContent = st.filter((k) => k === "trial").length;
  document.getElementById("sExpired").textContent = st.filter((k) => k === "expired" || k === "canceled").length;
  document.getElementById("sPending").textContent = rows.filter((r) => isPending(r.p)).length;
  const mrr = rows.reduce((acc, r) => {
    if (statusOf(r.p).key !== "active") return acc;
    return acc + (r.p.plan === "yearly" ? PRICES.yearly / 12 : PRICES.monthly);
  }, 0);
  document.getElementById("sMrr").textContent = `₪${Math.round(mrr).toLocaleString("he-IL")}`;
}

function matchesFilter(r) {
  const s = statusOf(r.p);
  const dl = daysLeft(s.end);
  if (filter === "pending" && !isPending(r.p)) return false;
  if (filter === "soon" && !((s.key === "active" || s.key === "trial") && dl !== null && dl <= 7)) return false;
  if (filter === "trial" && s.key !== "trial") return false;
  if (filter === "active" && s.key !== "active") return false;
  if (filter === "expired" && !(s.key === "expired" || s.key === "canceled")) return false;
  if (search) {
    const hay = `${r.p.email || ""} ${(r.p.upgradeRequest || {}).phone || ""} ${r.p.adminNote || ""}`.toLowerCase();
    if (!hay.includes(search)) return false;
  }
  return true;
}

function renderPayments(uid) {
  const list = paymentsCache[uid];
  if (!list) return `<div class="payments note">טוען תשלומים...</div>`;
  if (!list.length) return `<div class="payments note">אין תשלומים רשומים.</div>`;
  return `<div class="payments"><table>
    <tr><th>תאריך</th><th>סכום</th><th>מסלול</th><th>בתוקף עד</th><th>הערה</th></tr>
    ${list.map((x) => `<tr><td>${fmtDate(x.paidAt)}</td><td>₪${esc(x.amount)}</td><td>${x.plan === "yearly" ? "שנתי" : x.plan === "monthly" ? "חודשי" : "אחר"}</td><td>${fmtDate(x.periodEnd)}</td><td>${esc(x.note || "")}</td></tr>`).join("")}
  </table></div>`;
}

function renderCard(r) {
  const { uid, p, cas } = r;
  const s = statusOf(p);
  const dl = daysLeft(s.end);
  const soon = (s.key === "active" || s.key === "trial") && dl !== null && dl <= 7;
  const req = p.upgradeRequest || {};
  const pending = isPending(p);
  const owner = s.key === "owner";
  const sync = cas
    ? (cas.lastSyncError
        ? `<span class="error">שגיאת סנכרון: ${esc(cas.lastSyncError)}</span>`
        : `סונכרן: ${fmtDateTime(cas.lastSyncedAt)} (${esc(cas.lastSyncCount ?? 0)} מסופים)`)
    : "טרם חובר לכספונט";
  return `
    <div class="card ${pending ? "pending" : ""}" data-uid="${esc(uid)}">
      <div class="row">
        <div>
          <span class="email">${esc(p.email || uid)}</span>
          <span class="badge b-${s.key}">${esc(s.label)}</span>
          ${soon ? `<span class="badge b-soon">נותרו ${dl} ימים</span>` : ""}
        </div>
        <div class="note">נרשם: ${fmtDate(p.createdAt)}</div>
      </div>
      <div class="meta">
        <span>${s.key === "trial" || (s.key === "expired" && !p.currentPeriodEnd) ? "סוף ניסיון" : "בתוקף עד"}: ${owner ? "ללא הגבלה" : fmtDate(s.end)}</span>
        <span>${sync}</span>
        ${p.adminNote ? `<span>📝 ${esc(p.adminNote)}</span>` : ""}
      </div>
      ${req.requestedAt ? `
        <div class="request">
          💳 ${pending ? "<b>בקשת שדרוג ממתינה</b>" : "בקשת שדרוג (טופלה)"}:
          ${esc(req.planLabel || req.planId || "")} · טלפון: ${req.phone ? `<a href="tel:${esc(req.phone)}">${esc(req.phone)}</a>` : "—"} · ${fmtDateTime(req.requestedAt)}
        </div>` : ""}
      ${owner ? "" : `
      <div class="actions">
        <button type="button" class="btn-green" data-act="activate" data-plan="monthly">✅ הפעל חודשי (₪${PRICES.monthly})</button>
        <button type="button" class="btn-green" data-act="activate" data-plan="yearly">✅ הפעל שנתי (₪${PRICES.yearly})</button>
        <button type="button" data-act="trial">⏳ הארך ניסיון</button>
        ${pending ? `<button type="button" data-act="handled">✔️ סמן בקשה כטופלה</button>` : ""}
        <button type="button" data-act="note">📝 הערה</button>
        <button type="button" data-act="payments">🧾 תשלומים</button>
        ${s.key === "active" ? `<button type="button" class="btn-danger" data-act="cancel">⛔ בטל מנוי</button>` : ""}
      </div>`}
      ${openPayments.has(uid) ? renderPayments(uid) : ""}
    </div>`;
}

function render() {
  renderStats();
  const list = rows
    .filter(matchesFilter)
    .sort((a, b) => Number(isPending(b.p)) - Number(isPending(a.p)) || Number(b.p.createdAt || 0) - Number(a.p.createdAt || 0));
  document.getElementById("list").innerHTML = list.length
    ? list.map(renderCard).join("")
    : `<div class="card note">אין מפיצים להצגה.</div>`;
}

async function load() {
  const [snap, notesSnap] = await Promise.all([
    db.collection("distributors").get(),
    db.collection("adminNotes").get()
  ]);
  const notes = {};
  notesSnap.forEach((n) => { notes[n.id] = (n.data() || {}).note || ""; });
  rows = await Promise.all(snap.docs.map(async (d) => {
    let cas = null;
    try {
      const c = await d.ref.collection("settings").doc("cas_sync").get();
      cas = c.exists ? c.data() : null;
    } catch (e) { /* ignore */ }
    return { uid: d.id, p: { ...(d.data() || {}), adminNote: notes[d.id] || "" }, cas };
  }));
  render();
}

async function loadPayments(uid) {
  const snap = await db.collection("distributors").doc(uid).collection("payments").orderBy("paidAt", "desc").get();
  paymentsCache[uid] = snap.docs.map((d) => d.data());
}

async function activate(uid, plan) {
  const r = rows.find((x) => x.uid === uid);
  const p = r.p;
  const now = Date.now();
  const currentEnd = p.subscriptionStatus === "active" ? Number(p.currentPeriodEnd) || 0 : 0;
  const base = Math.max(now, currentEnd);
  const end = addMonths(base, plan === "yearly" ? 12 : 1);
  const amountStr = prompt(`סכום ששולם (₪) עבור ${p.email || uid}:`, String(PRICES[plan]));
  if (amountStr === null) return;
  const amount = Number(String(amountStr).replace(/[,₪\s]/g, ""));
  if (!Number.isFinite(amount) || amount < 0) { alert("סכום לא תקין"); return; }
  const note = (prompt("הערה לתשלום (אופציונלי, למשל אמצעי תשלום / מספר קבלה):", "") || "").slice(0, 200);
  if (!confirm(`להפעיל מנוי ${plan === "yearly" ? "שנתי" : "חודשי"} ל-${p.email || uid} עד ${fmtDate(end)}?`)) return;

  const ref = db.collection("distributors").doc(uid);
  const batch = db.batch();
  const update = { subscriptionStatus: "active", plan, currentPeriodEnd: end };
  if (isPending(p)) update["upgradeRequest.handledAt"] = now;
  batch.update(ref, update);
  batch.set(ref.collection("payments").doc(), { amount, plan, periodEnd: end, paidAt: now, ...(note ? { note } : {}) });
  await batch.commit();
  delete paymentsCache[uid];
}

async function extendTrial(uid) {
  const r = rows.find((x) => x.uid === uid);
  const input = prompt(`בכמה ימים להאריך את הניסיון של ${r.p.email || uid}?`, "7");
  if (input === null) return;
  const days = Number(input);
  if (!Number.isInteger(days) || days <= 0 || days > 365) { alert("מספר ימים לא תקין"); return; }
  const base = Math.max(Date.now(), Number(r.p.trialEndsAt) || 0);
  await db.collection("distributors").doc(uid).update({ subscriptionStatus: "trial", trialEndsAt: base + days * DAY });
}

async function cancel(uid) {
  const r = rows.find((x) => x.uid === uid);
  if (!confirm(`לבטל את המנוי של ${r.p.email || uid}? הגישה לעריכה והסנכרון ייעצרו מיד.`)) return;
  await db.collection("distributors").doc(uid).update({ subscriptionStatus: "canceled" });
}

async function editNote(uid) {
  const r = rows.find((x) => x.uid === uid);
  const input = prompt("הערה פנימית למפיץ (רק אתה רואה):", r.p.adminNote || "");
  if (input === null) return;
  // ההערה נשמרת באוסף נפרד שרק המנהל רואה (לא על הפרופיל של המפיץ)
  await db.collection("adminNotes").doc(uid).set({ note: input.trim().slice(0, 500), updatedAt: Date.now() });
}

document.getElementById("list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const uid = btn.closest(".card").getAttribute("data-uid");
  const act = btn.getAttribute("data-act");
  btn.disabled = true;
  try {
    if (act === "activate") await activate(uid, btn.getAttribute("data-plan"));
    else if (act === "trial") await extendTrial(uid);
    else if (act === "cancel") await cancel(uid);
    else if (act === "note") await editNote(uid);
    else if (act === "handled") await db.collection("distributors").doc(uid).update({ "upgradeRequest.handledAt": Date.now() });
    else if (act === "payments") {
      if (openPayments.has(uid)) openPayments.delete(uid);
      else { openPayments.add(uid); render(); await loadPayments(uid); }
      render();
      return;
    }
    await load();
  } catch (err) {
    alert("הפעולה נכשלה: " + (err && err.message ? err.message : String(err)));
  } finally {
    btn.disabled = false;
  }
});

document.querySelectorAll(".filters button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".filters button").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  filter = b.getAttribute("data-filter");
  render();
}));
document.getElementById("searchInput").addEventListener("input", (e) => { search = e.target.value.trim().toLowerCase(); render(); });

document.getElementById("loginBtn").addEventListener("click", async () => {
  const err = document.getElementById("authError");
  err.textContent = "";
  try {
    await auth.signInWithEmailAndPassword(document.getElementById("emailInput").value.trim(), document.getElementById("passwordInput").value);
  } catch (e) {
    err.textContent = e && e.message ? e.message : "שגיאה בהתחברות";
  }
});
document.getElementById("logoutBtn").addEventListener("click", () => auth.signOut());
document.getElementById("logoutBtn2").addEventListener("click", () => auth.signOut());

auth.onAuthStateChanged(async (user) => {
  document.getElementById("authSection").classList.toggle("hidden", Boolean(user));
  document.getElementById("noAccess").classList.toggle("hidden", !user || user.uid === ADMIN_UID);
  document.getElementById("appSection").classList.toggle("hidden", !user || user.uid !== ADMIN_UID);
  if (user && user.uid === ADMIN_UID) {
    try { await load(); } catch (e) { alert("טעינה נכשלה: " + e.message); }
  }
});
  