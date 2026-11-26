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

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
auth.languageCode = "he"; // מיילים של איפוס סיסמה / אימות - בעברית
const db = firebase.firestore();
// עבודה בלי קליטה: הנתונים נשמרים במכשיר והשינויים נשלחים כשהחיבור חוזר
db.enablePersistence({ synchronizeTabs: true }).catch((err) => console.warn("offline persistence unavailable:", err && err.code));

const ADMIN_UID = "TblW8UHDSBTh91BCJcqo3YKEqQJ3";
const TERMS_VERSION = "2026-11-26";

// ---------- מחירון לפי מספר מסופים (לא כולל מע"מ; שנתי = 11 חודשים) ----------
const PRICE_TIERS = [
  { max: 20, name: "בסיס", monthly: 29, yearly: 319 },
  { max: 50, name: "מקצועי", monthly: 49, yearly: 539 },
  { max: 100, name: "מתקדם", monthly: 79, yearly: 869 },
  { max: 200, name: "עסקי", monthly: 119, yearly: 1309 },
  { max: Infinity, name: "ללא הגבלה", monthly: 179, yearly: 1969 }
];
function tierFor(count) {
  return PRICE_TIERS.find((t) => Number(count || 0) <= t.max) || PRICE_TIERS[PRICE_TIERS.length - 1];
}

// ---------- חבר מביא חבר: שומרים את הקוד מהקישור עד ההרשמה ----------
const SITE_URL = "https://erezc1981.github.io/atm-distributors-pro/";
(function captureReferral() {
  const ref = new URLSearchParams(location.search).get("ref");
  if (ref && /^[A-Za-z0-9]{10,40}$/.test(ref)) {
    try { localStorage.setItem("atm_ref", ref); } catch (e) { /* ignore */ }
  }
})();
let dataUid = null;      // של מי הנתונים שמוצגים: המפיץ עצמו, או המפיץ שהזמין את העובד
let userRole = "owner";  // "owner" (מפיץ) או "driver" (עובד)
let workerName = "";     // שם העובד המחובר (נרשם בכל הטענה); למפיץ - "המפיץ"

const AUTH_ERRORS_HE = {
  "auth/invalid-email": "כתובת האימייל לא תקינה.",
  "auth/missing-email": "יש להזין אימייל.",
  "auth/missing-password": "יש להזין סיסמה.",
  "auth/user-not-found": "האימייל או הסיסמה שגויים.",
  "auth/wrong-password": "האימייל או הסיסמה שגויים.",
  "auth/invalid-credential": "האימייל או הסיסמה שגויים.",
  "auth/invalid-login-credentials": "האימייל או הסיסמה שגויים.",
  "auth/email-already-in-use": "כבר קיים חשבון עם האימייל הזה. נסה להתחבר או לאפס סיסמה.",
  "auth/weak-password": "הסיסמה חלשה מדי - לפחות 6 תווים.",
  "auth/too-many-requests": "יותר מדי ניסיונות. נסה שוב בעוד כמה דקות.",
  "auth/network-request-failed": "אין חיבור לאינטרנט. בדוק את החיבור ונסה שוב.",
  "auth/user-disabled": "החשבון הזה הושבת. פנה לתמיכה.",
  "auth/requires-recent-login": "מטעמי אבטחה יש להתחבר מחדש ולנסות שוב.",
  "permission-denied": "אין הרשאה לפעולה הזו.",
  "unavailable": "אין חיבור לשרת כרגע. נסה שוב בעוד רגע."
};
function errorHe(err, fallback) {
  const code = err && err.code ? String(err.code) : "";
  return AUTH_ERRORS_HE[code] || fallback || "אירעה שגיאה. נסה שוב.";
}

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const TRIAL_DAYS_DEFAULT = 30;

const ADJUSTMENTS = {
  refillDay: { midweek: 0, thursday: 25 },
  monthPeriod: { regular: 0, salaries: 15, allowances: 15 },
  jewishMode: { regular: 0, eve_holiday: 35, holiday: -75 },
  arabMode: { regular: 0, eve_eid: 35, ramadan: 15 }
};

let currentUser = null;
let currentTerminals = [];
let searchQuery = "";
let unsubscribeTerminals = null;
let unsubscribeCas = null;
let unsubscribeProfile = null;
let selectedPlan = { id: "monthly", label: "חודשי (₪29 / חודש)" };
let subscriptionValid = true;

// מפתח ציבורי להצפנת סיסמת כספונט (RSA-OAEP SHA-256). המפתח הפרטי נמצא רק ב-GitHub Secret של הסנכרון.
const CAS_PUBLIC_KEY_B64 = "MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA0JPcLc3Y/GaNa1vh3gI4vi0hAUWaBe8SgLPWXcPDHghJ10PId5XaV6XNDPvwqb3r7BHmZOpS2hphfYNBmq3HE2od3SnUT92lnZTDHW0dFHQ7AOJQqt6bL9OCzvUDZiViQy3dsKPIFoZ5j8Jk4A28yQ6vPikNymqrS0BS6dtGYNNpWkVSK6jOfzHBx1d3cHzdeSAdwJkSNpCaVELReKxbyZxsYcNV2xHIosQPc2C4uNfKsjuaeftZaajByXCZcNpt4Jk1GElyuysq7kawU+wP2tQEpFmWAe6XL7zP2BV8ddPxccbaUt9slUcrujCpGSmmns3nHvISrq1tH7O8VLJr9m205Rtx6YsJ0RWmB6arWWfIn9cN/CK4vAjk9ywVNA7GZAT22wcbyJq1ATVw1t9JlrC9O8i6NjK1sFsQDxISOxV9KlVFD0aoGc7Ydo0k8aVEalSAGibrKz7y+PxkifIxAj7jP6L6O+1Si8nFY9klvj2IH/E1bvvui5Ra7dj1hhRXAgMBAAE=";

async function encryptCasPassword(plain) {
  const der = Uint8Array.from(atob(CAS_PUBLIC_KEY_B64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("spki", der, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const enc = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, new TextEncoder().encode(plain));
  let bin = "";
  new Uint8Array(enc).forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
const SAFE_TERMINAL_ID = /^[A-Za-z0-9_-]{1,40}$/;

// חוסם עריכה כשהמנוי/הניסיון הסתיים (האכיפה האמיתית נמצאת ב-firestore.rules)
// פעולות ניהול (סף, יעד, מגזר, סדר, הסתרה) - למפיץ בלבד, לא לעובד
function guardManage() {
  if (userRole === "driver") {
    alert("פעולה זו זמינה רק למפיץ.");
    return false;
  }
  return guardWrite();
}

function guardWrite() {
  if (!currentUser || !dataUid) return false;
  if (!subscriptionValid && userRole === "driver") {
    alert("המנוי של המפיץ הסתיים - לא ניתן לעדכן כרגע.");
    return false;
  }
  if (!subscriptionValid) {
    document.getElementById("paymentFeedback").textContent = "תקופת הניסיון הסתיימה - יש לשדרג כדי להמשיך לערוך.";
    document.getElementById("paymentModal").classList.remove("hidden");
    return false;
  }
  return true;
}

function setLockedState(locked) {
  subscriptionValid = !locked;
  document.getElementById("lockBanner").classList.toggle("hidden", !locked);
}

let activeRules = {
  refillDay: String(new Date().getDay()),
  monthPeriod: "regular",
  jewishMode: "regular",
  arabMode: "regular",
  extraPct: "0"
};

function escapeHtml(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAmountILS(val) {
  const num = Number(val ?? 0);
  return Number.isFinite(num) ? num.toLocaleString("he-IL") : "0";
}

function formatAmountK(val) {
  const num = Number(val ?? 0);
  if (!Number.isFinite(num) || num <= 0) return "0K";
  const kVal = num / 1000;
  const formattedK = Number.isInteger(kVal) ? String(kVal) : kVal.toFixed(1).replace(/\.0$/, "");
  return `${formattedK}K`;
}

function getTerminalTxMidnight(t) {
  const n = Number(t?.txSinceMidnight ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function updateTrialPill(profile = {}) {
  const pill = document.getElementById("trialDaysPill");
  const summary = document.getElementById("payTrialSummary");
  const status = profile.subscriptionStatus || "trial";
  const now = Date.now();

  const periodEnd = Number(profile.currentPeriodEnd) || 0;
  if (profile.plan === "owner_free" || (status === "active" && (!periodEnd || now <= periodEnd))) {
    pill.className = "trial-pill active-plan";
    pill.textContent = "מנוי פעיל";
    summary.textContent = "המנוי שלך פעיל.";
    setLockedState(false);
    return;
  }
  if (status === "active") {
    pill.className = "trial-pill expired";
    pill.textContent = "המנוי פג";
    summary.textContent = "תקופת המנוי הסתיימה. בחר מסלול כדי להמשיך.";
    setLockedState(true);
    return;
  }
  if (status !== "trial") {
    pill.className = "trial-pill expired";
    pill.textContent = "המנוי בוטל";
    summary.textContent = "המנוי בוטל. בחר מסלול כדי לחדש.";
    setLockedState(true);
    return;
  }

  const authCreatedMs = currentUser?.metadata?.creationTime
    ? Date.parse(currentUser.metadata.creationTime)
    : NaN;
  const createdAtMs = Number(profile.createdAt) || (Number.isFinite(authCreatedMs) ? authCreatedMs : now);
  const fallbackTrialEnd = createdAtMs + TRIAL_DAYS_DEFAULT * 24 * 60 * 60 * 1000;
  const trialEndMs = Number(profile.trialEndsAt) || fallbackTrialEnd;
  const diffMs = trialEndMs - now;
  const daysLeft = Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));

  if (daysLeft > 0) {
    pill.className = "trial-pill";
    pill.textContent = `ניסיון: ${daysLeft} ${daysLeft === 1 ? "יום נותר" : "ימים נותרו"}`;
    summary.textContent = `נותרו לך ${daysLeft} ימים לתקופת הניסיון. ניתן לשדרג למנוי מלא בכל עת.`;
    setLockedState(false);
  } else {
    pill.className = "trial-pill expired";
    pill.textContent = "ניסיון: 0 ימים (הסתיים)";
    summary.textContent = "תקופת הניסיון הסתיימה. בחר מסלול כדי להמשיך להשתמש במערכת.";
    setLockedState(true);
  }
}

function getTerminalThreshold(t) {
  const parsed = Number(t.threshold);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 3000;
}

function getTerminalSector(t) {
  if (t.sector === "arab") return "arab";
  if (t.sector === "none") return "none";
  return "jewish";
}

function hasConfiguredTargetK(t) {
  if (!t) return false;
  const raw = t.baseTargetK;
  if (raw === null || raw === undefined || raw === "") return false;
  const num = Number(raw);
  return Number.isFinite(num) && num >= 0;
}

function getEffectiveTargetK(t) {
  if (!hasConfiguredTargetK(t)) return null;
  const baseK = Number(t.baseTargetK);
  const dayPct = manualExtraPct();
  const periodPct = Number(ADJUSTMENTS.monthPeriod?.[activeRules.monthPeriod] ?? 0);
  const sector = getTerminalSector(t);
  const sectorPct = sector === "arab"
    ? Number(ADJUSTMENTS.arabMode?.[activeRules.arabMode] ?? 0)
    : sector === "jewish"
      ? Number(ADJUSTMENTS.jewishMode?.[activeRules.jewishMode] ?? 0)
      : 0;

  const totalFactor = (1 + dayPct / 100) * (1 + periodPct / 100) * (1 + sectorPct / 100);
  return Math.max(0, Math.round(baseK * totalFactor));
}

function calcLoadAmountILS(balance, targetK) {
  if (targetK === null || targetK === undefined) return 0;
  const targetAmount = Number(targetK) * 1000;
  const currentBal = Number(balance ?? 0);
  const rawDiff = Math.max(0, targetAmount - currentBal);
  if (rawDiff === 0) return 0;
  const roundedTo5k = Math.round(rawDiff / 5000) * 5000;
  return roundedTo5k > 0 ? roundedTo5k : 5000;
}

// חבילת 5K מהבנק נדרשת רק להטענה שמסתיימת ב-5 אלף (5K, 15K, 25K...) - את השאר משלימים בחבילות של 10K
function countPacks5k(amounts) {
  return amounts.filter((v) => Math.round(Number(v || 0) / 5000) % 2 === 1).length;
}


function renderDaysSelector(selectedDays = []) {
  const wrap = document.getElementById("daysContainer");
  wrap.innerHTML = DAYS.map((day, idx) => {
    const checked = selectedDays.includes(idx) ? "checked" : "";
    return `<label class="day-chip"><input type="checkbox" value="${idx}" ${checked} /> ${escapeHtml(day)}</label>`;
  }).join("");
}

function syncRuleChipButtons() {
  const active = [];
  document.querySelectorAll(".chip-btn").forEach((btn) => {
    const grp = btn.getAttribute("data-rule-group");
    const v = btn.getAttribute("data-rule-val");
    const on = activeRules[grp] === v;
    btn.classList.toggle("active", on);
    if (on && grp !== "refillDay" && grp !== "extraPct" && v !== "regular") active.push(btn.textContent.trim());
  });
  const pct = manualExtraPct();
  const pctInput = document.getElementById("extraPctInput");
  if (pctInput && document.activeElement !== pctInput) {
    pctInput.value = ["0", "25", "50"].includes(String(activeRules.extraPct ?? "0")) ? "" : String(pct);
  }
  if (pct) active.unshift(`תוספת ${pct > 0 ? "+" : ""}${pct}%`);
  const dayIdx = Number(activeRules.refillDay);
  if (Number.isInteger(dayIdx) && dayIdx >= 0 && dayIdx <= 6) active.unshift(`ביקור ${DAYS[dayIdx]}`);
  // תקציר ההתאמות הפעילות בכותרת המקופלת
  const sum = document.getElementById("rulesSummary");
  if (sum) {
    sum.textContent = active.length ? active.join(" · ") : "רגיל";
    sum.classList.toggle("rules-active", active.some((a) => !a.startsWith("ביקור ") || a.includes("%")));
  }
}

// ---------- התאמות חישוב אוטומטיות לפי תאריך הביקור ----------
// לוח חגים (תאריך -> מצב). תאריכי חגים מוסלמיים תלויים בראיית הירח (±יום) - אפשר לשנות ידנית.
const HOLIDAY_CALENDAR = {
  jewish: {
    // 2026
    "2026-04-01": "eve_holiday", "2026-04-02": "holiday", "2026-04-07": "eve_holiday", "2026-04-08": "holiday",
    "2026-05-21": "eve_holiday", "2026-05-22": "holiday",
    "2026-09-11": "eve_holiday", "2026-09-12": "holiday", "2026-09-13": "holiday",
    "2026-09-20": "eve_holiday", "2026-09-21": "holiday",
    "2026-09-25": "eve_holiday", "2026-09-26": "holiday", "2026-10-02": "eve_holiday", "2026-10-03": "holiday",
    // 2027
    "2027-04-21": "eve_holiday", "2027-04-22": "holiday", "2027-04-27": "eve_holiday", "2027-04-28": "holiday",
    "2027-06-10": "eve_holiday", "2027-06-11": "holiday",
    "2027-10-01": "eve_holiday", "2027-10-02": "holiday", "2027-10-03": "holiday",
    "2027-10-10": "eve_holiday", "2027-10-11": "holiday",
    "2027-10-15": "eve_holiday", "2027-10-16": "holiday", "2027-10-22": "eve_holiday", "2027-10-23": "holiday"
  },
  arabEves: ["2027-03-09", "2027-05-15"],                       // ערב עיד אל-פיטר / עיד אל-אדחא
  ramadan: [["2027-02-08", "2027-03-08"]]                         // טווחי רמדאן
};

// תוספת באחוזים נקבעת רק ידנית (לא עולה אוטומטית בחמישי או בחגים)
function manualExtraPct() {
  const n = Math.round(Number(activeRules.extraPct));
  return Number.isFinite(n) ? Math.min(300, Math.max(-90, n)) : 0;
}

// רמז בלבד: איזה חג/מועד יוצא בתאריך הביקור (הבחירה עצמה ידנית)
function holidayHintFor(iso) {
  const j = HOLIDAY_CALENDAR.jewish[iso];
  if (j === "eve_holiday") return "ערב חג";
  if (j === "holiday") return "חג";
  if (HOLIDAY_CALENDAR.arabEves.includes(iso)) return "ערב עיד";
  if (HOLIDAY_CALENDAR.ramadan.some(([a, b]) => iso >= a && iso <= b)) return "רמדאן";
  return "";
}

// התאריך הקרוב (כולל היום) שבו יוצא יום השבוע הזה
function visitDateFor(dayIdx) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    if (d.getDay() === dayIdx) return d;
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function autoRulesFor(dayIdx) {
  const date = visitDateFor(dayIdx);
  const iso = date.toLocaleDateString("en-CA");
  const dom = date.getDate();
  // חגים ותוספת באחוזים - לא אוטומטיים; רק התקופה בחודש נבחרת לפי התאריך
  return {
    refillDay: String(dayIdx),
    monthPeriod: dom >= 8 && dom <= 12 ? "salaries" : dom >= 26 && dom <= 29 ? "allowances" : "regular",
    jewishMode: "regular",
    arabMode: "regular",
    extraPct: "0"
  };
}

// יום הביקור הבא: היום אם הוא יום קו, אחרת יום הקו הבא
function nextVisitDay() {
  const today = new Date().getDay();
  for (let i = 0; i < 7; i++) if (routeDays.includes((today + i) % 7)) return (today + i) % 7;
  return today;
}

let rulesOverride = null; // { date, refillDay, monthPeriod, jewishMode, arabMode }
let routeDays = [0, 2, 4];

function applyAutoRules() {
  const day = nextVisitDay();
  const auto = autoRulesFor(day);
  const iso = visitDateFor(day).toLocaleDateString("en-CA");
  const ov = rulesOverride && rulesOverride.date >= new Date().toLocaleDateString("en-CA") ? rulesOverride : null;
  if (ov) {
    activeRules = {
      refillDay: String(ov.refillDay ?? auto.refillDay),
      monthPeriod: ov.monthPeriod || auto.monthPeriod,
      jewishMode: ov.jewishMode || auto.jewishMode,
      arabMode: ov.arabMode || auto.arabMode,
      extraPct: String(ov.extraPct ?? auto.extraPct)
    };
  } else {
    activeRules = auto;
  }
  const note = document.getElementById("rulesAutoNote");
  if (note) {
    const visit = visitDateFor(Number(activeRules.refillDay));
    const shownIso = visit.toLocaleDateString("he-IL");
    const hint = holidayHintFor(visit.toLocaleDateString("en-CA"));
    note.textContent = (ov
      ? `נבחר ידנית לביקור ב-${shownIso}. בתאריך הבא החישוב יחזור לברירת המחדל.`
      : `ביקור ב-${shownIso}: יום ותקופה בחודש נבחרו לפי התאריך. חגים ותוספת באחוזים - בחירה ידנית.`)
      + (hint ? ` 💡 בתאריך הזה: ${hint} - אפשר לבחור ידנית למטה.` : "");
  }
  syncRuleChipButtons();
  updateStatsAndList(currentTerminals);
}

function renderRefillDayChips() {
  const wrap = document.getElementById("refillDayChips");
  if (!wrap) return;
  const days = [...new Set(routeDays)].sort((a, b) => a - b);
  wrap.innerHTML = days.map((d) =>
    `<button type="button" class="chip-btn" data-rule-group="refillDay" data-rule-val="${d}">${DAYS[d]}</button>`
  ).join("") || `<span class="status-note">לא הוגדרו ימי קו לחלוקה (תפריט ← ימי קו לחלוקה)</span>`;
}

async function saveRulesOverride() {
  const iso = visitDateFor(Number(activeRules.refillDay)).toLocaleDateString("en-CA");
  rulesOverride = { date: iso, ...activeRules };
  try { localStorage.setItem(`atm_rules_${dataUid}`, JSON.stringify(rulesOverride)); } catch (e) { /* ignore */ }
  applyAutoRules();
  // המפיץ שומר גם בשרת, כדי שהבחירה תופיע בכל המכשירים ואצל העובדים
  if (userRole === "owner" && dataUid && subscriptionValid) {
    db.collection("distributors").doc(dataUid).collection("settings").doc("route")
      .set({ calcModes: rulesOverride }, { merge: true })
      .catch((err) => console.warn("save calc modes failed:", err && err.code));
  }
}

// ---------- ממשק: חלוניות, הודעות, זמן סנכרון ----------
let lastSyncedAtMs = 0;
let lastSyncHasError = false;

function relativeTimeHe(ms) {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (min < 1) return "עכשיו";
  if (min < 60) return `לפני ${min} דק'`;
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? "לפני שעה" : `לפני ${h} שעות`;
  return `ב-${new Date(ms).toLocaleDateString("he-IL")}`;
}

function updateSyncPill() {
  const pill = document.getElementById("lastSyncPill");
  if (!pill || userRole === "driver") return;
  pill.classList.toggle("sync-error", lastSyncHasError);
  pill.classList.toggle("sync-stale", !lastSyncHasError && lastSyncedAtMs > 0 && Date.now() - lastSyncedAtMs > 90 * 60000);
  if (lastSyncHasError) pill.textContent = "⚠️ שגיאת סנכרון - ראה תפריט ← חיבור לכספונט";
  else if (lastSyncedAtMs) pill.textContent = `עודכן ${relativeTimeHe(lastSyncedAtMs)}`;
  else pill.textContent = "ממתין לסנכרון ראשון...";
}
setInterval(updateSyncPill, 60000);

// כשכרטיס הסיכום יוצא מהמסך בגלילה - הסרגל העליון מציג תקציר שלו
(function watchSummaryCard() {
  const card = document.querySelector(".summary-card");
  const bar = document.querySelector(".appbar");
  if (!card || !bar || !("IntersectionObserver" in window)) return;
  new IntersectionObserver(([entry]) => {
    bar.classList.toggle("scrolled", !entry.isIntersecting && entry.boundingClientRect.top < 0);
  }, { rootMargin: "-60px 0px 0px 0px", threshold: 0 }).observe(card);
})();

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 4500);
}

let sheetReturnFocus = null;
function closeSheets() {
  const wasOpen = document.querySelector(".sheet:not(.hidden)");
  document.querySelectorAll(".sheet").forEach((s) => s.classList.add("hidden"));
  if (wasOpen && sheetReturnFocus && document.contains(sheetReturnFocus)) sheetReturnFocus.focus();
  document.getElementById("sheetBackdrop").classList.add("hidden");
  document.body.classList.remove("sheet-open");
}

function openSheet(id) {
  document.querySelectorAll(".sheet").forEach((s) => s.classList.add("hidden"));
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("hidden");
  el.scrollTop = 0;
  document.getElementById("sheetBackdrop").classList.remove("hidden");
  document.body.classList.add("sheet-open");
  // נגישות: מעבירים את המיקוד לחלון שנפתח, ו-Esc סוגר
  if (!el.contains(document.activeElement)) sheetReturnFocus = document.activeElement;
  if (!el.hasAttribute("aria-label")) {
    const head = el.querySelector(".sheet-head strong");
    if (head) el.setAttribute("aria-label", head.textContent.replace(/^[^\p{L}]+/u, "").trim());
  }
  el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.querySelector(".sheet:not(.hidden)")) closeSheets();
});

function toggleSheet(id) {
  const el = document.getElementById(id);
  if (el && el.classList.contains("hidden")) openSheet(id); else closeSheets();
}

document.addEventListener("click", (e) => {
  const opener = e.target.closest("[data-open-sheet]");
  if (opener) { openSheet(opener.getAttribute("data-open-sheet")); return; }
  if (e.target.closest("[data-close-sheet]") || e.target.id === "sheetBackdrop") { closeSheets(); return; }
  const proxy = e.target.closest("[data-proxy]");
  if (proxy) { document.getElementById(proxy.getAttribute("data-proxy"))?.click(); return; }
  if (e.target.closest("[data-scroll-top]")) { closeSheets(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  if (e.target.closest("[data-toggle-hidden]")) {
    const cb = document.getElementById("showHiddenInput");
    cb.checked = !cb.checked;
    updateStatsAndList(currentTerminals);
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheets(); });

function renderTerminalCard(t, index) {
  const id = String(t.id ?? "");
  const safeIdAttr = escapeHtml(id);
  const safeIdText = escapeHtml(id);
  const safeName = escapeHtml(t.name ?? `מסוף ${id}`);
  const thresholdNum = getTerminalThreshold(t);
  const threshold = formatAmountILS(thresholdNum);
  const targetK = getEffectiveTargetK(t);
  const hasTarget = targetK !== null;
  const rawBalance = Number(t.balance ?? 0);
  const balanceFormatted = formatAmountILS(rawBalance);
  const txMidnight = getTerminalTxMidnight(t);
  const loadAmount = hasTarget ? calcLoadAmountILS(rawBalance, targetK) : 0;
  const isAlert = rawBalance <= thresholdNum;
  const isDone = Boolean(t.refilled);
  const sector = getTerminalSector(t);
  const sectorLabel = sector === "arab"
    ? "מגזר ערבי"
    : sector === "jewish"
      ? "מגזר יהודי"
      : "ללא מגזר";
  const sectorClass = sector === "arab"
    ? "sector-arab"
    : sector === "jewish"
      ? "sector-jewish"
      : "sector-none";

  const paperNeeded = Boolean(t.paperRollNeeded);
  // תקינות מסוף: תקשורת אחרונה מעל 5 שעות, אין עסקאות עד 12:00 (כמו בהתראות הוואטסאפ)
  const lastComm = Number(t.lastCommAt) || 0;
  const noComm = lastComm > 0 && Date.now() - lastComm > 5 * 3600 * 1000;
  const noActivity = new Date().getHours() >= 12 && txMidnight === 0;
  const hhmm = (ms) => new Date(ms).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const noteText = String(t.notes ?? "").trim();
  const safeNoteText = escapeHtml(noteText);
  const targetDisplayText = hasTarget ? `${targetK}K` : "—";

  let fillDisplayHtml;
  if (!hasTarget) {
    fillDisplayHtml = `<span class="fill-display empty-target">יעד לא הוגדר</span>`;
  } else if (loadAmount > 0) {
    fillDisplayHtml = `<span class="fill-display">למלא ${formatAmountK(loadAmount)}</span>`;
  } else {
    fillDisplayHtml = `<span class="fill-display ok-badge">תקין (0)</span>`;
  }

  const isHidden = Boolean(t.hidden);
  const cardClasses = [
    "terminal-card",
    isAlert && !isHidden ? "" : "ok",
    isDone || isHidden ? "done" : ""
  ].filter(Boolean).join(" ");

  const fillClass = !hasTarget ? "fill-none" : loadAmount > 0 ? "fill-need" : "fill-ok";
  const fillText = !hasTarget ? "יעד לא הוגדר" : loadAmount > 0 ? `למלא ${formatAmountK(loadAmount)}` : "תקין ✓";
  const moreOpen = openMoreIds.has(id);
  const cls = [cardClasses, isAlert && !isHidden ? "alert" : "", moreOpen ? "show-more" : ""].filter(Boolean).join(" ");

  return `
    <article class="${cls}" data-terminal-id="${safeIdAttr}">
      <div class="tc-top">
        <span class="row-index">${index + 1}</span>
        <div class="tc-name">
          <div class="title-row">
            <button type="button" class="nav-btn${hasLocation(t) ? "" : " no-loc"}" data-act="navTerminal" data-id="${safeIdAttr}" aria-label="${hasLocation(t) ? "ניווט למסוף" : "הוספת מיקום למסוף"}" title="${hasLocation(t) ? "ניווט (Waze / Google Maps)" : "הוסף מיקום לניווט"}"><svg class="nav-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="#33ccff" stroke="#0b2a3a" stroke-width="1.4" d="M12 3.2c4.9 0 8.6 3.4 8.6 7.7 0 3.1-1.9 5.6-4.7 6.9l-.6 2.1c-.2.6-.9.8-1.4.4l-1.5-1.3c-.1 0-.3.1-.4.1-4.9 0-8.6-3.4-8.6-7.7S7.1 3.2 12 3.2z"/><circle cx="9.3" cy="10" r="1.1" fill="#0b2a3a"/><circle cx="14.7" cy="10" r="1.1" fill="#0b2a3a"/><path d="M9 13.1c.8.9 1.8 1.3 3 1.3s2.2-.4 3-1.3" fill="none" stroke="#0b2a3a" stroke-width="1.3" stroke-linecap="round"/></svg></button>
            <div class="terminal-title">${safeName}</div>
          </div>
          <div class="tc-sub">מזהה ${safeIdText} · סף ₪${threshold}</div>
        </div>
        <div class="tc-balance${isAlert && !isHidden ? " low" : ""}">
          <div class="tc-balance-val">₪${balanceFormatted}</div>
          <div class="tc-balance-lbl">במחסנית</div>
        </div>
      </div>
      <div class="tc-chips">
        <button type="button" class="chip sector-badge ${sectorClass}" title="החלפת מגזר" data-act="toggleTerminalSector" data-id="${safeIdAttr}">${sectorLabel}</button>
        ${paperNeeded ? `<button type="button" class="chip chip-warn" title="לחץ לביטול" data-act="togglePaperRoll" data-id="${safeIdAttr}">🧻 נייר להחלפה</button>` : ""}
        ${isHidden ? `<span class="chip chip-muted">מוסתר</span>` : ""}
        ${noComm && !isHidden ? `<span class="chip chip-offline" title="תקשורת אחרונה: ${hhmm(lastComm)}">📡 אין תקשורת מ-${hhmm(lastComm)}</span>` : ""}
        ${noActivity && !isHidden ? `<span class="chip chip-warn">💤 אין פעילות היום</span>` : ""}
        <span class="chip chip-muted">${formatAmountILS(txMidnight)} עסקאות מחצות</span>
      </div>
      ${noteText ? `<button type="button" class="tc-note" title="ערוך הערה" data-act="editTerminalNote" data-id="${safeIdAttr}">📝 ${safeNoteText}</button>` : ""}
      <div class="tc-actions">
        <div class="tc-fill ${fillClass}">
          <span class="tc-fill-main">${fillText}</span>
          <span class="tc-fill-sub">יעד ${targetDisplayText}</span>
        </div>
        <button type="button" class="check-btn ${isDone ? "checked" : ""}" data-act="toggleCompleted" data-id="${safeIdAttr}">${isDone ? "✓ הוטען" : "סמן הטענה"}</button>
        <button type="button" class="more-btn" aria-label="פעולות נוספות" aria-expanded="${moreOpen}" data-act="toggleMore" data-id="${safeIdAttr}">⋯</button>
      </div>
      <div class="tc-more">
        <button type="button" data-act="togglePaperRoll" data-id="${safeIdAttr}">🧻 ${paperNeeded ? "בטל סימון נייר" : "נגמר נייר"}</button>
        <button type="button" data-act="editTerminalNote" data-id="${safeIdAttr}">📝 ${noteText ? "ערוך הערה" : "הוסף הערה"}</button>
        <button type="button" data-act="editLocation" data-id="${safeIdAttr}">📍 ${hasLocation(t) ? "עדכן מיקום" : "הוסף מיקום"}</button>
        <button type="button" class="owner-only" data-act="openEditTargetModal" data-id="${safeIdAttr}">🎯 יעד מילוי</button>
        <button type="button" class="owner-only" data-act="editTerminalThreshold" data-id="${safeIdAttr}">🔔 סף התראה</button>
        <button type="button" class="owner-only" data-act="moveTerminal" data-id="${safeIdAttr}" data-arg="-1">▲ הזז למעלה</button>
        <button type="button" class="owner-only" data-act="moveTerminal" data-id="${safeIdAttr}" data-arg="1">▼ הזז למטה</button>
        <button type="button" class="owner-only" data-act="toggleHidden" data-id="${safeIdAttr}">${isHidden ? "👁 החזר לרשימה" : "🙈 הסתר מסוף"}</button>
      </div>
    </article>`;
}

// פתיחת "⋯" נשמרת גם כשהרשימה מתרעננת מהסנכרון
const openMoreIds = new Set();
window.toggleMore = function (terminalId) {
  const id = String(terminalId);
  if (openMoreIds.has(id)) openMoreIds.delete(id); else openMoreIds.add(id);
  const card = document.querySelector(`.terminal-card[data-terminal-id="${CSS.escape(id)}"]`);
  if (card) {
    card.classList.toggle("show-more", openMoreIds.has(id));
    const btn = card.querySelector(".more-btn");
    if (btn) btn.setAttribute("aria-expanded", String(openMoreIds.has(id)));
  }
};

function updateStatsAndList(allTerminals) {
  // מסופים מוסתרים לא נספרים בסיכומים ובהתראות; מוצגים רק כשמסמנים "הצג מסופים מוסתרים"
  const showHidden = document.getElementById("showHiddenInput").checked;
  const terminals = allTerminals.filter((t) => !t.hidden);
  const listSource = showHidden ? allTerminals : terminals;
  const jewishTotal = terminals.filter((t) => getTerminalSector(t) === "jewish").length;
  const arabTotal = terminals.filter((t) => getTerminalSector(t) === "arab").length;
  document.getElementById("jewishCountLabel").textContent = `מגזר יהודי (${jewishTotal}):`;
  document.getElementById("arabCountLabel").textContent = `מגזר ערבי (${arabTotal}):`;

  const q = searchQuery.trim().toLowerCase();
  const matches = (t) =>
    !q ||
    String(t.name || "").toLowerCase().includes(q) ||
    String(t.id || "").toLowerCase().includes(q) ||
    String(t.notes || "").toLowerCase().includes(q);
  const listed = listSource.filter(matches);
  const filtered = q
    ? terminals.filter(
        (t) =>
          String(t.name || "").toLowerCase().includes(q) ||
          String(t.id || "").toLowerCase().includes(q) ||
          String(t.notes || "").toLowerCase().includes(q)
      )
    : terminals;

  const listEl = document.getElementById("terminalsList");
  if (!listed.length) {
    listEl.innerHTML = `<div class="panel status-note">אין מסופים להצגה. לחץ על "כספונט" או "רענן" כדי לסנכרן מול כספונט.</div>`;
  } else {
    listEl.innerHTML = listed.map((t, idx) => renderTerminalCard(t, idx)).join("");
  }
  // קישור להצגת / הסתרת מסופים מוסתרים, מתחת לרשימה
  const hiddenCount = allTerminals.length - terminals.length;
  if (hiddenCount > 0 && userRole === "owner") {
    listEl.insertAdjacentHTML("beforeend", `<button type="button" class="hidden-toggle" data-toggle-hidden>
      ${showHidden
        ? (hiddenCount === 1 ? "🙈 הסתר שוב את המסוף המוסתר" : `🙈 הסתר שוב את ${hiddenCount} המסופים המוסתרים`)
        : `👁 ${hiddenCount === 1 ? "מסוף אחד מוסתר" : `${hiddenCount} מסופים מוסתרים`} · הצג`}
    </button>`);
  }

  const totalBalance = filtered.reduce((acc, t) => acc + Number(t.balance ?? 0), 0);
  const totalTxMidnight = filtered.reduce((acc, t) => acc + getTerminalTxMidnight(t), 0);
  const loads = filtered.map((t) => (t.refilled ? 0 : calcLoadAmountILS(t.balance, getEffectiveTargetK(t))));
  const totalToLoad = loads.reduce((acc, v) => acc + v, 0);
  const stationsToFill = loads.filter((v) => v > 0).length;
  const totalPacks5k = countPacks5k(loads);
  const alertTerminals = filtered.filter((t) => Number(t.balance ?? 0) <= getTerminalThreshold(t));

  const bannerEl = document.getElementById("alertBanner");
  if (alertTerminals.length > 0) {
    const itemsText = alertTerminals
      .map((t) => `${String(t.name ?? "")} (₪${formatAmountILS(t.balance)})`)
      .join(", ");
    bannerEl.textContent = `🚨 התראת יתרה נמוכה ב-${alertTerminals.length} מסופים: ${itemsText}`;
    bannerEl.classList.remove("hidden");
  } else {
    bannerEl.classList.add("hidden");
  }

  document.getElementById("statCount").textContent = String(filtered.length);
  document.getElementById("statBalance").textContent = `₪${formatAmountILS(totalBalance)}`;
  document.getElementById("statTxMidnight").textContent = formatAmountILS(totalTxMidnight);
  document.getElementById("statToLoad").textContent = `₪${formatAmountILS(totalToLoad)}`;
  document.getElementById("statStationsToFill").textContent = `${stationsToFill} תחנות למילוי`;
  document.getElementById("statPacks5k").textContent = String(totalPacks5k);
  document.getElementById("statAlerts").textContent = String(alertTerminals.length);
  document.getElementById("appbarMini").innerHTML =
    `להטעין <b>₪${formatAmountILS(totalToLoad)}</b> · ${stationsToFill} תחנות${alertTerminals.length ? ` · 🚨 ${alertTerminals.length}` : ""}`;
}

window.toggleTerminalSector = async function (terminalId) {
  if (!guardManage()) return;
  const t = currentTerminals.find((x) => String(x.id) === String(terminalId));
  if (!t) return;
  const currentSector = getTerminalSector(t);
  const nextSector = currentSector === "jewish"
    ? "arab"
    : currentSector === "arab"
      ? "none"
      : "jewish";
  await db
    .collection("distributors")
    .doc(dataUid)
    .collection("terminals")
    .doc(String(terminalId))
    .set({ sector: nextSector }, { merge: true });
};

window.togglePaperRoll = async function (terminalId) {
  if (!guardWrite()) return;
  const t = currentTerminals.find((x) => String(x.id) === String(terminalId));
  if (!t) return;
  const nextState = !Boolean(t.paperRollNeeded);
  await db
    .collection("distributors")
    .doc(dataUid)
    .collection("terminals")
    .doc(String(terminalId))
    .set({ paperRollNeeded: nextState }, { merge: true });
};

window.toggleHidden = async function (terminalId) {
  if (!guardManage()) return;
  const t = currentTerminals.find((x) => String(x.id) === String(terminalId));
  if (!t) return;
  await db
    .collection("distributors")
    .doc(dataUid)
    .collection("terminals")
    .doc(String(terminalId))
    .set({ hidden: !Boolean(t.hidden) }, { merge: true });
};

// שינוי סדר המסלול: מחליף מקום עם המסוף הסמוך ושומר סדר רציף 1..N
window.moveTerminal = async function (terminalId, dir) {
  if (!guardManage()) return;
  const list = [...currentTerminals];
  const idx = list.findIndex((x) => String(x.id) === String(terminalId));
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= list.length) return;
  [list[idx], list[target]] = [list[target], list[idx]];
  const batch = db.batch();
  const col = db.collection("distributors").doc(dataUid).collection("terminals");
  list.forEach((t, i) => {
    if (Number(t.order) !== i + 1) batch.set(col.doc(String(t.id)), { order: i + 1 }, { merge: true });
  });
  try {
    await batch.commit();
  } catch (err) {
    alert("שינוי הסדר נכשל: " + (err && err.message ? err.message : String(err)));
  }
};

window.editTerminalThreshold = async function (terminalId) {
  if (!guardManage()) return;
  const t = currentTerminals.find((x) => String(x.id) === String(terminalId));
  const currentThresh = getTerminalThreshold(t || {});
  const input = prompt(`הזן סף התראה בשקלים (₪) למסוף ${t?.name || terminalId} (${terminalId}):`, String(currentThresh));
  if (input === null) return;
  const cleaned = input.replace(/,/g, "").replace(/₪/g, "").trim();
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) {
    alert("יש להזין סכום תקין בשקלים");
    return;
  }
  await db
    .collection("distributors")
    .doc(dataUid)
    .collection("terminals")
    .doc(String(terminalId))
    .set({ threshold: Math.round(parsed) }, { merge: true });
};

window.editTerminalNote = async function (terminalId) {
  if (!guardWrite()) return;
  const t = currentTerminals.find((x) => String(x.id) === String(terminalId));
  const initialNote = String(t?.notes ?? "");
  const input = prompt(`הערות למסוף ${t?.name || terminalId} (${terminalId}):`, initialNote);
  if (input === null) return;
  await db
    .collection("distributors")
    .doc(dataUid)
    .collection("terminals")
    .doc(String(terminalId))
    .set({ notes: input.trim() }, { merge: true });
};

window.openEditTargetModal = async function (terminalId) {
  if (!guardManage()) return;
  const t = currentTerminals.find((x) => String(x.id) === String(terminalId));
  const initialVal = hasConfiguredTargetK(t) ? String(Number(t.baseTargetK)) : "";
  const input = prompt(`הזן יעד מילוי באלפים (k) למסוף ${terminalId}:`, initialVal);
  if (input === null) return;
  const trimmed = input.trim();
  if (trimmed === "") {
    await db
      .collection("distributors")
      .doc(dataUid)
      .collection("terminals")
      .doc(String(terminalId))
      .set({ baseTargetK: null }, { merge: true });
    return;
  }
  const parsedK = Number(trimmed);
  if (!Number.isFinite(parsedK) || parsedK < 0) {
    alert("יש להזין מספר תקין באלפים");
    return;
  }
  await db
    .collection("distributors")
    .doc(dataUid)
    .collection("terminals")
    .doc(String(terminalId))
    .set({ baseTargetK: parsedK }, { merge: true });
};

window.toggleCompleted = async function (terminalId) {
  if (!guardWrite()) return;
  const t = currentTerminals.find((x) => String(x.id) === String(terminalId));
  if (!t) return;

  const nextDone = !Boolean(t.refilled);
  const distRef = db.collection("distributors").doc(dataUid);
  const termRef = distRef.collection("terminals").doc(String(terminalId));
  const batch = db.batch();

  if (nextDone) {
    // רישום הטענה בהיסטוריה - עם הסכום שהוטען בפועל (ברירת מחדל: הסכום המחושב)
    const suggested = calcLoadAmountILS(t.balance, getEffectiveTargetK(t));
    const input = prompt(`כמה הוטען במסוף ${t.name || terminalId}? (₪)`, suggested ? String(suggested) : "");
    if (input === null) return;
    const amount = Number(String(input).replace(/[,₪\s]/g, ""));
    if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) {
      alert("יש להזין סכום תקין בשקלים");
      return;
    }
    const refillRef = distRef.collection("refills").doc();
    const now = Date.now();
    batch.set(refillRef, {
      terminalId: String(terminalId),
      terminalName: String(t.name || terminalId).slice(0, 80),
      amount: Math.round(amount),
      balanceBefore: Math.round(Number(t.balance) || 0),
      at: now,
      byUid: currentUser.uid,
      byEmail: currentUser.email || "",
      byName: String(workerName || "").slice(0, 60)
    });
    batch.set(termRef, { refilled: true, lastRefilledAt: now, lastRefillId: refillRef.id }, { merge: true });
  } else {
    if (!confirm(`לבטל את סימון ההטענה של ${t.name || terminalId}? גם הרישום בהיסטוריה יימחק.`)) return;
    if (t.lastRefillId) batch.delete(distRef.collection("refills").doc(String(t.lastRefillId)));
    batch.set(termRef, { refilled: false, lastRefilledAt: null, lastRefillId: null }, { merge: true });
  }

  // בלי קליטה ה-commit ממתין לחיבור, אבל המסך מתעדכן מיד מהנתונים המקומיים
  batch.commit().catch((err) => {
    console.error("toggleCompleted failed:", err);
    alert("שגיאה בעדכון הטענה: " + errorHe(err, err && err.message));
  });
};

// לחיצה על התאמת חישוב: נשמרת לתאריך הביקור (ומתאפסת לבד בתאריך הבא)
document.querySelector(".rules-bar").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip-btn");
  if (!btn) return;
  const grp = btn.getAttribute("data-rule-group");
  const val = btn.getAttribute("data-rule-val");
  if (grp === "refillDay") {
    // יום ביקור אחר = תאריך אחר: מחשבים מחדש תקופה וחגים לתאריך הזה
    activeRules = autoRulesFor(Number(val));
  } else {
    activeRules[grp] = val;
  }
  syncRuleChipButtons();
  updateStatsAndList(currentTerminals);
  saveRulesOverride();
});

// אחוז ידני חופשי (שדה "אחר")
document.getElementById("extraPctInput").addEventListener("change", (e) => {
  const raw = String(e.target.value || "").trim();
  const n = raw === "" ? 0 : Math.round(Number(raw));
  if (!Number.isFinite(n)) return;
  activeRules.extraPct = String(Math.min(300, Math.max(-90, n)));
  syncRuleChipButtons();
  updateStatsAndList(currentTerminals);
  saveRulesOverride();
});

async function triggerCasSync(uid) {
  if (!uid || !subscriptionValid) return;
  const casDocRef = db.collection("distributors").doc(uid).collection("settings").doc("cas_sync");
  const snap = await casDocRef.get();
  const statusEl = document.getElementById("casSyncStatus");

  if (!snap.exists || !(snap.data() || {}).username) {
    statusEl.textContent = "טרם הוגדרו פרטי כספונט. פתח את 'כספונט' להזנת פרטים.";
    return;
  }

  await casDocRef.set({
    syncRequested: false,
    syncRequestedAt: Date.now(),
  }, { merge: true });

  statusEl.textContent = "הבקשה נרשמה. מסנכרן מול כספונט...";
  requestLiveSync(true);
}

function bindUserListeners(uid) {
  if (unsubscribeTerminals) unsubscribeTerminals();
  if (unsubscribeCas) unsubscribeCas();
  if (unsubscribeProfile) unsubscribeProfile();

  const userRef = db.collection("distributors").doc(uid);

  unsubscribeProfile = userRef.onSnapshot((snap) => {
    const data = snap.exists ? (snap.data() || {}) : {};
    updateTrialPill(data);
    updateReferralStats(data);
  }, (err) => console.warn("profile listener:", err && err.code));

  // ימי קו + בחירת התאמות חישוב שנשמרה (גם לעובדים - לקריאה בלבד)
  userRef.collection("settings").doc("route").get().then((snap) => {
    const data = snap.exists ? (snap.data() || {}) : {};
    const days = Array.isArray(data.days) && data.days.length ? data.days : [0, 2, 4];
    routeDays = days.map(Number).filter((d) => d >= 0 && d <= 6);
    renderDaysSelector(routeDays);
    let local = null;
    try { local = JSON.parse(localStorage.getItem(`atm_rules_${uid}`) || "null"); } catch (e) { /* ignore */ }
    const remote = data.calcModes && data.calcModes.date ? data.calcModes : null;
    rulesOverride = [remote, local].filter(Boolean).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
    renderRefillDayChips();
    applyAutoRules();
  }).catch((err) => console.warn("route load:", err && err.code));

  const isDriver = userRole === "driver";
  if (isDriver) {
    document.getElementById("lastSyncPill").textContent = "עובד";
  } else {

  userRef.collection("settings").doc("alerts").get().then((snap) => {
    const data = snap.exists ? (snap.data() || {}) : {};
    document.getElementById("alertPhoneInput").value = data.phone || "";
    document.getElementById("alertEnabledInput").checked = data.enabled !== false;
  }).catch(() => {});

  unsubscribeCas = userRef.collection("settings").doc("cas_sync").onSnapshot((snap) => {
    const statusEl = document.getElementById("casSyncStatus");
    const pillEl = document.getElementById("lastSyncPill");
    if (!snap.exists) {
      statusEl.textContent = "טרם הוגדרו פרטי כספונט.";
      pillEl.textContent = "לא סונכרן";
      return;
    }
    const data = snap.data() || {};
    if (data.username && !document.getElementById("casUserInput").value) {
      document.getElementById("casUserInput").value = data.username;
    }
    document.getElementById("casPassState").textContent = data.passwordEnc
      ? "🔒 סיסמה שמורה (מוצפנת). להחלפה - הזן סיסמה חדשה ושמור."
      : "🔒 הסיסמה מוצפנת בדפדפן לפני השמירה, ורק שרת הסנכרון יכול לפענח אותה.";
    lastSyncedAtMs = Number(data.lastSyncedAt) || 0;
    lastSyncHasError = Boolean(data.lastSyncError);
    if (data.lastSyncError) {
      statusEl.textContent = `שגיאת סנכרון: ${String(data.lastSyncError)}`;
    } else if (data.lastSyncedAt) {
      const dt = new Date(Number(data.lastSyncedAt)).toLocaleString("he-IL");
      statusEl.textContent = `סונכרן לאחרונה מכספונט: ${dt} (${data.lastSyncCount ?? 0} מסופים)`;
    }
    updateSyncPill();
  });

  } // סוף הגדרות מפיץ

  unsubscribeTerminals = userRef.collection("terminals").onSnapshot((snap) => {
    currentTerminals = snap.docs
      .filter((d) => SAFE_TERMINAL_ID.test(d.id))
      .map((d) => ({ ...d.data(), id: d.id }))
      .sort((a, b) => Number(a.order ?? 9999) - Number(b.order ?? 9999));
    updateStatsAndList(currentTerminals);
  });
}

function renderPriceTier() {
  const tier = tierFor(currentTerminals.length);
  const m = `₪${tier.monthly} / חודש`;
  const y = `₪${tier.yearly.toLocaleString("he-IL")} / שנה`;
  document.getElementById("priceMonthly").textContent = m;
  document.getElementById("priceYearly").textContent = y;
  document.querySelector('.plan-option[data-plan="monthly"]').setAttribute("data-price", m);
  document.querySelector('.plan-option[data-plan="yearly"]').setAttribute("data-price", y);
  const sel = document.querySelector(".plan-option.selected") || document.querySelector(".plan-option");
  selectedPlan = { id: sel.getAttribute("data-plan"), label: `${sel.children[0].textContent} - ${tier.name} (${sel.getAttribute("data-price")})` };
  const range = tier.max === Infinity ? "" : `, עד ${tier.max}`;
  document.getElementById("tierNote").textContent =
    `מסלול ${tier.name} (${currentTerminals.length} מסופים${range}). המחירים לא כוללים מע"מ.`;
}

document.getElementById("openPayModalBtn").addEventListener("click", () => {
  closeSheets();
  renderPriceTier();
  document.getElementById("paymentFeedback").textContent = "";
  document.getElementById("paymentModal").classList.remove("hidden");
});

document.getElementById("closePayModalBtn").addEventListener("click", () => {
  document.getElementById("paymentModal").classList.add("hidden");
});

document.querySelectorAll(".plan-option").forEach((el) => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".plan-option").forEach((o) => o.classList.remove("selected"));
    el.classList.add("selected");
    renderPriceTier();
  });
});

document.getElementById("confirmPaymentBtn").addEventListener("click", async () => {
  if (!currentUser) return;
  const phone = document.getElementById("payerPhoneInput").value.trim();
  const feedback = document.getElementById("paymentFeedback");
  await db.collection("distributors").doc(dataUid).set({
    upgradeRequest: {
      planId: selectedPlan.id,
      planLabel: selectedPlan.label,
      phone,
      requestedAt: Date.now()
    }
  }, { merge: true });
  feedback.textContent = `בקשת התשלום עבור מסלול ${selectedPlan.label} נרשמה.`;
});

document.getElementById("searchInput").addEventListener("input", (e) => {
  searchQuery = e.target.value || "";
  updateStatsAndList(currentTerminals);
});

// ---------- סנכרון מול כספונט: בכל כניסה לאתר/לאפליקציה ובלחיצה על "רענן" ----------
// הבקשה נשלחת לשרת ממסר קטן (Cloudflare Worker) שמאמת את המשתמש ומפעיל את ריצת הסנכרון.
const SYNC_RELAY_URL = "https://atm-sync.erezc1981.workers.dev";
const AUTO_SYNC_MIN_GAP_MS = 5 * 60 * 1000; // בכניסה: לא מסנכרנים שוב אם עודכן ב-5 הדקות האחרונות
let lastSyncRequestMs = 0;

async function requestLiveSync(manual) {
  if (!currentUser || !dataUid) return;
  const now = Date.now();
  if (!manual && (now - lastSyncedAtMs < AUTO_SYNC_MIN_GAP_MS || now - lastSyncRequestMs < AUTO_SYNC_MIN_GAP_MS)) return;
  if (now - lastSyncRequestMs < 60 * 1000) {
    if (manual) showToast("הסנכרון כבר בדרך - הנתונים יתעדכנו תוך כדקה.");
    return;
  }
  if (!SYNC_RELAY_URL) {
    if (manual) showToast("הנתונים נטענו מחדש. סנכרון מיידי מול כספונט יופעל אחרי הקמת השרת הממסר.");
    return;
  }
  lastSyncRequestMs = now;
  try {
    const token = await currentUser.getIdToken();
    const res = await fetch(SYNC_RELAY_URL, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
    if (manual || out.started) showToast(out.started ? "🔄 מסנכרן מול כספונט... הנתונים יתעדכנו תוך כדקה." : "הסנכרון כבר רץ - הנתונים יתעדכנו תוך כדקה.");
  } catch (err) {
    lastSyncRequestMs = 0;
    if (manual) showToast("הפעלת הסנכרון נכשלה. נסה שוב בעוד רגע.");
    console.warn("sync relay:", err && err.message);
  }
}

// חזרה לאפליקציה מהרקע = כניסה מחדש
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") requestLiveSync(false);
});

document.getElementById("refreshBtn").addEventListener("click", async () => {
  const btn = document.getElementById("refreshBtn");
  btn.disabled = true;
  try {
    if (currentUser && dataUid) {
      bindUserListeners(dataUid);
      await requestLiveSync(true);
    }
  } finally {
    setTimeout(() => { btn.disabled = false; }, 800);
  }
});

document.getElementById("loginBtn").addEventListener("click", async () => {
  const errEl = document.getElementById("authError");
  errEl.textContent = "";
  const email = document.getElementById("emailInput").value.trim();
  const pass = document.getElementById("passwordInput").value;
  try {
    await auth.signInWithEmailAndPassword(email, pass);
  } catch (err) {
    errEl.textContent = errorHe(err, "שגיאה בהתחברות");
  }
});

document.getElementById("forgotBtn").addEventListener("click", async () => {
  const errEl = document.getElementById("authError");
  const infoEl = document.getElementById("authInfo");
  errEl.textContent = "";
  infoEl.textContent = "";
  const email = document.getElementById("emailInput").value.trim();
  if (!email) {
    errEl.textContent = "הזן את האימייל שלך ואז לחץ שוב על \"שכחתי סיסמה\".";
    return;
  }
  try {
    await auth.sendPasswordResetEmail(email);
  } catch (err) {
    if (err && err.code === "auth/invalid-email") { errEl.textContent = errorHe(err); return; }
    // לא חושפים אם קיים חשבון עם האימייל
  }
  infoEl.textContent = "אם קיים חשבון עם האימייל הזה, נשלח אליו קישור לאיפוס סיסמה. בדוק גם בספאם.";
});

function referralField(uid) {
  let ref = "";
  try { ref = localStorage.getItem("atm_ref") || ""; } catch (e) { /* ignore */ }
  return /^[A-Za-z0-9]{10,40}$/.test(ref) && ref !== uid ? { referredBy: ref } : {};
}

document.getElementById("registerBtn").addEventListener("click", async () => {
  const errEl = document.getElementById("authError");
  errEl.textContent = "";
  const email = document.getElementById("emailInput").value.trim();
  const pass = document.getElementById("passwordInput").value;
  if (!document.getElementById("termsCheckbox").checked) {
    errEl.textContent = "יש לאשר את תנאי השימוש ומדיניות הפרטיות כדי להירשם.";
    return;
  }
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    cred.user.sendEmailVerification().catch(() => {});
    // עובד שהוזמן לא מקבל חשבון מפיץ - הוא יצורף למפיץ אחרי אימות האימייל
    const invite = await findInviteFor(cred.user);
    if (invite) return;
    const now = Date.now();
    await db.collection("distributors").doc(cred.user.uid).set({
      email,
      subscriptionStatus: "trial",
      createdAt: now,
      trialEndsAt: now + TRIAL_DAYS_DEFAULT * 24 * 60 * 60 * 1000,
      termsAcceptedAt: now,
      termsVersion: TERMS_VERSION,
      ...referralField(cred.user.uid)
    });
    try { localStorage.removeItem("atm_ref"); } catch (e) { /* ignore */ }
    // הפרופיל נוצר אחרי ש-onAuthStateChanged כבר רץ - טוענים מחדש את התפקיד
    await startSession(cred.user);
  } catch (err) {
    errEl.textContent = errorHe(err, "שגיאה בהרשמה");
  }
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  auth.signOut();
});

document.getElementById("toggleRouteBtn").addEventListener("click", () => {
  toggleSheet("routePanel");
});

document.getElementById("toggleCasBtn").addEventListener("click", () => {
  toggleSheet("casPanel");
});

document.getElementById("toggleAlertsBtn").addEventListener("click", () => {
  toggleSheet("alertsPanel");
});

document.getElementById("showHiddenInput").addEventListener("change", () => {
  updateStatsAndList(currentTerminals);
});

document.getElementById("saveAlertsBtn").addEventListener("click", async () => {
  if (!guardWrite()) return;
  const phone = document.getElementById("alertPhoneInput").value.replace(/[^\d+]/g, "");
  if (phone && phone.replace(/\D/g, "").length < 9) {
    alert("מספר הטלפון לא תקין");
    return;
  }
  try {
    await db.collection("distributors").doc(dataUid).collection("settings").doc("alerts").set({
      phone,
      enabled: document.getElementById("alertEnabledInput").checked,
      updatedAt: Date.now()
    });
    document.getElementById("alertsSavedMsg").textContent = "נשמר";
    setTimeout(() => { document.getElementById("alertsSavedMsg").textContent = ""; }, 2000);
  } catch (err) {
    alert("השמירה נכשלה: " + (err && err.message ? err.message : String(err)));
  }
});

document.getElementById("saveRouteBtn").addEventListener("click", async () => {
  if (!guardWrite()) return;
  const days = [...document.querySelectorAll("#daysContainer input:checked")].map((el) => Number(el.value));
  if (!days.length) {
    alert("יש לסמן לפחות יום קו אחד");
    return;
  }
  const msg = document.getElementById("routeSavedMsg");
  try {
    await db.collection("distributors").doc(dataUid).collection("settings").doc("route").set({
      days,
      updatedAt: Date.now()
    }, { merge: true });
  } catch (err) {
    alert("שמירת ימי הקו לחלוקה נכשלה: " + errorHe(err, err && err.message));
    return;
  }
  routeDays = days;
  renderRefillDayChips();
  applyAutoRules();
  msg.textContent = "✓ נשמר";
  setTimeout(() => { msg.textContent = ""; }, 2500);
});

document.getElementById("saveAndSyncCasBtn").addEventListener("click", async () => {
  if (!guardWrite()) return;
  const username = document.getElementById("casUserInput").value.trim();
  const passInput = document.getElementById("casPassInput");
  const plainPass = passInput.value;
  if (!username) {
    alert("יש להזין שם משתמש של כספונט");
    return;
  }
  const payload = {
    username,
    syncRequested: false,
    syncRequestedAt: Date.now(),
    updatedAt: Date.now()
  };
  if (plainPass) {
    try {
      payload.passwordEnc = await encryptCasPassword(plainPass);
    } catch (err) {
      alert("הצפנת הסיסמה נכשלה. נסה שוב מדפדפן מעודכן.");
      return;
    }
  }
  try {
    await db.collection("distributors").doc(dataUid).collection("settings").doc("cas_sync").set(payload, { merge: true });
  } catch (err) {
    alert("השמירה נכשלה: " + (err && err.message ? err.message : String(err)));
    return;
  }
  passInput.value = "";

  document.getElementById("casSyncStatus").textContent = plainPass
    ? "הפרטים נשמרו (הסיסמה מוצפנת). המסופים יסונכרנו מכספונט בכניסה הבאה או בלחיצה על רענן."
    : "שם המשתמש נשמר. המסופים יסונכרנו מכספונט בכניסה הבאה או בלחיצה על רענן.";
});

document.getElementById("whatsappBtn").addEventListener("click", () => {
  const visibleTerminals = currentTerminals.filter((t) => !t.hidden);
  const totalToLoad = visibleTerminals.reduce(
    (acc, t) => acc + (t.refilled ? 0 : calcLoadAmountILS(t.balance, getEffectiveTargetK(t))),
    0
  );
  const totalTxMidnight = visibleTerminals.reduce(
    (acc, t) => acc + getTerminalTxMidnight(t),
    0
  );
  const totalPacks5k = countPacks5k(visibleTerminals.map((t) => (t.refilled ? 0 : calcLoadAmountILS(t.balance, getEffectiveTargetK(t)))));
  const lines = [
    "*דוח מצב מסופים*",
    `סה"כ להטענה: ₪${formatAmountILS(totalToLoad)} | חבילות 5K מהבנק: ${totalPacks5k} | עסקאות מחצות: ${formatAmountILS(totalTxMidnight)}`,
    ""
  ];
  visibleTerminals.forEach((t, idx) => {
    const targetK = getEffectiveTargetK(t);
    const loadAmt = t.refilled ? 0 : calcLoadAmountILS(t.balance, targetK);
    const targetLabel = targetK !== null ? `${targetK}K` : "לא הוגדר";
    const statusText = t.refilled
      ? "הוטען ✓"
      : (targetK === null
        ? "יעד לא הוגדר"
        : (loadAmt > 0 ? `למלא ${formatAmountK(loadAmt)}` : "תקין (0)"));
    const paperPart = t.paperRollNeeded ? " | 🧻 נייר להחלפה" : "";
    const notePart = t.notes ? ` | הערות: ${t.notes}` : "";
    lines.push(`${idx + 1}. ${t.name} (${t.id}): במחסנית ₪${formatAmountILS(t.balance)} | עסקאות מחצות: ${formatAmountILS(getTerminalTxMidnight(t))} | יעד ${targetLabel} | ${statusText}${paperPart}${notePart}`);
  });
  const url = `https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`;
  window.open(url, "_blank", "noopener");
});

renderDaysSelector([0, 2, 4]);
renderRefillDayChips();
applyAutoRules();

// ---------- תפקיד המשתמש: מפיץ / עובד ----------

function escapeAttr(v) { return escapeHtml(v); }

async function findInviteFor(user) {
  const email = String(user && user.email || "").trim().toLowerCase();
  if (!email) return null;
  try {
    const snap = await db.collection("invites").doc(email).get();
    return snap.exists ? { id: email, ...snap.data() } : null;
  } catch (err) {
    return null;
  }
}

async function resolveRole(user) {
  const cacheKey = `atm_role_${user.uid}`;
  try {
    const mem = await db.collection("memberships").doc(user.uid).get();
    if (mem.exists) {
      const m = mem.data() || {};
      const r = { role: "driver", dataUid: m.distributorUid, distributorEmail: m.distributorEmail || "", name: m.name || "" };
      localStorage.setItem(cacheKey, JSON.stringify(r));
      return r;
    }
    const prof = await db.collection("distributors").doc(user.uid).get();
    if (prof.exists) {
      const r = { role: "owner", dataUid: user.uid };
      localStorage.setItem(cacheKey, JSON.stringify(r));
      return r;
    }
    const invite = await findInviteFor(user);
    if (invite) {
      if (!user.emailVerified) return { role: "pending-driver", invite };
      // הצטרפות: יצירת שיוך לעובד ומחיקת ההזמנה
      const batch = db.batch();
      batch.set(db.collection("memberships").doc(user.uid), {
        distributorUid: invite.distributorUid,
        distributorEmail: invite.distributorEmail || "",
        email: user.email,
        name: String(invite.name || "").slice(0, 60),
        role: "driver",
        joinedAt: Date.now()
      });
      batch.delete(db.collection("invites").doc(invite.id));
      await batch.commit();
      const r = { role: "driver", dataUid: invite.distributorUid, distributorEmail: invite.distributorEmail || "", name: invite.name || "" };
      localStorage.setItem(cacheKey, JSON.stringify(r));
      return r;
    }
    return { role: "owner", dataUid: user.uid };
  } catch (err) {
    // בלי קליטה - משתמשים בתפקיד האחרון שנשמר במכשיר
    const cached = localStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);
    return { role: "owner", dataUid: user.uid };
  }
}

async function startSession(user) {
  currentUser = user;
  document.getElementById("authSection").classList.add("hidden");
  document.getElementById("appSection").classList.remove("hidden");
  document.getElementById("userEmailBadge").textContent = user.email || "";
  // קישור לניהול מנויים - רק למנהל (ההרשאה עצמה נאכפת ב-firestore.rules)
  document.getElementById("adminLink").classList.toggle("hidden", user.uid !== ADMIN_UID);

  const r = await resolveRole(user);
  if (auth.currentUser !== user) return; // המשתמש התנתק בינתיים
  const driverBanner = document.getElementById("driverBanner");

  if (r.role === "pending-driver") {
    userRole = "driver";
    dataUid = null;
    document.body.classList.add("role-driver");
    driverBanner.textContent = `הוזמנת כעובד ע"י ${r.invite.distributorEmail || "מפיץ"}. אמת את האימייל (נשלח אליך קישור) ולחץ "כבר אימתתי" כדי להצטרף.`;
    driverBanner.classList.remove("hidden");
    document.getElementById("verifyBanner").classList.remove("hidden");
    document.getElementById("terminalsList").innerHTML = "";
    return;
  }

  userRole = r.role;
  dataUid = r.dataUid;
  workerName = userRole === "driver" ? (r.name || user.email || "") : "המפיץ";
  document.body.classList.toggle("role-driver", userRole === "driver");
  if (userRole === "driver") {
    driverBanner.textContent = `👷 ${r.name ? r.name + " - " : ""}מחובר כעובד של ${r.distributorEmail || "המפיץ"}. אפשר לסמן הטענות, נייר והערות.`;
    driverBanner.classList.remove("hidden");
  } else {
    driverBanner.classList.add("hidden");
  }
  const needVerify = !user.emailVerified && user.uid !== ADMIN_UID && userRole === "owner";
  document.getElementById("verifyBanner").classList.toggle("hidden", !needVerify);
  bindUserListeners(dataUid);
  if (userRole === "owner") loadDrivers().catch(() => {});
  // כניסה לאתר/לאפליקציה: מסנכרנים (אחרי שזמן הסנכרון האחרון נטען, כדי לא לסנכרן סתם)
  setTimeout(() => requestLiveSync(false), 2500);
}

document.getElementById("resendVerifyBtn").addEventListener("click", async () => {
  if (!currentUser) return;
  try {
    await currentUser.sendEmailVerification();
    alert("נשלח קישור אימות לאימייל שלך. בדוק גם בספאם.");
  } catch (err) {
    alert(errorHe(err, "השליחה נכשלה, נסה שוב בעוד כמה דקות."));
  }
});

document.getElementById("checkVerifyBtn").addEventListener("click", async () => {
  if (!currentUser) return;
  await currentUser.reload();
  if (!auth.currentUser.emailVerified) {
    alert("האימייל עדיין לא אומת. לחץ על הקישור שנשלח אליך ונסה שוב.");
    return;
  }
  await auth.currentUser.getIdToken(true); // רענון ההרשאות אחרי האימות
  await startSession(auth.currentUser);
});

// ---------- עובדים ----------

async function loadDrivers() {
  const el = document.getElementById("driversList");
  if (!dataUid || userRole !== "owner") return;
  const [mems, invs] = await Promise.all([
    db.collection("memberships").where("distributorUid", "==", dataUid).get(),
    db.collection("invites").where("distributorUid", "==", dataUid).get()
  ]);
  const items = [];
  mems.forEach((d) => {
    const m = d.data() || {};
    items.push(`<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0;">👷 <b>${escapeHtml(m.name || "ללא שם")}</b> <span>${escapeHtml(m.email || "")}</span> <span>· עובד פעיל</span>
      <button type="button" data-rename-member="${escapeAttr(d.id)}" data-current-name="${escapeAttr(m.name || "")}">✏️ שנה שם</button>
      <button type="button" data-remove-member="${escapeAttr(d.id)}">הסר</button></div>`);
  });
  invs.forEach((d) => {
    const inv = d.data() || {};
    items.push(`<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0;">✉️ <b>${escapeHtml(inv.name || "")}</b> ${escapeHtml(d.id)} <span>· ממתין להרשמה</span>
      <button type="button" data-cancel-invite="${escapeAttr(d.id)}">בטל הזמנה</button></div>`);
  });
  el.innerHTML = items.length ? items.join("") : "אין עובדים עדיין.";
}

document.getElementById("driversList").addEventListener("click", async (e) => {
  const rm = e.target.closest("[data-remove-member]");
  const ci = e.target.closest("[data-cancel-invite]");
  const rn = e.target.closest("[data-rename-member]");
  try {
    if (rn) {
      const input = prompt("שם העובד:", rn.getAttribute("data-current-name") || "");
      if (input === null) return;
      const name = input.trim().slice(0, 60);
      if (!name) { alert("יש להזין שם"); return; }
      await db.collection("memberships").doc(rn.getAttribute("data-rename-member")).update({ name });
    } else if (rm && confirm("להסיר את העובד? הוא יאבד גישה מיד.")) {
      await db.collection("memberships").doc(rm.getAttribute("data-remove-member")).delete();
    } else if (ci) {
      await db.collection("invites").doc(ci.getAttribute("data-cancel-invite")).delete();
    } else {
      return;
    }
    await loadDrivers();
  } catch (err) {
    alert(errorHe(err, "הפעולה נכשלה"));
  }
});

document.getElementById("inviteDriverBtn").addEventListener("click", async () => {
  if (!guardManage()) return;
  if (!currentUser.emailVerified && currentUser.uid !== ADMIN_UID) {
    alert("יש לאמת קודם את האימייל שלך (ראה ההודעה בראש המסך).");
    return;
  }
  const name = document.getElementById("driverNameInput").value.trim().slice(0, 60);
  if (!name) {
    alert("יש להזין את שם העובד");
    return;
  }
  const email = document.getElementById("driverEmailInput").value.trim().toLowerCase();
  if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email) || email.length > 120) {
    alert("כתובת אימייל לא תקינה");
    return;
  }
  if (email === String(currentUser.email || "").toLowerCase()) {
    alert("לא ניתן להזמין את עצמך");
    return;
  }
  try {
    await db.collection("invites").doc(email).set({
      distributorUid: dataUid,
      distributorEmail: currentUser.email || "",
      name,
      createdAt: Date.now()
    });
    document.getElementById("driverEmailInput").value = "";
    document.getElementById("driverNameInput").value = "";
    await loadDrivers();
    const appUrl = location.origin + location.pathname;
    const text = `היי ${name}, הוזמנת להצטרף כעובד לאפליקציית ניהול הכספומטים. הירשם עם האימייל ${email} כאן: ${appUrl}`;
    if (confirm("ההזמנה נשמרה. לשלוח לעובד את הקישור בוואטסאפ?")) {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    }
  } catch (err) {
    alert(errorHe(err, "ההזמנה נכשלה (ייתכן שהאימייל כבר הוזמן ע\"י מפיץ אחר)"));
  }
});

// ---------- מיקום וניווט למסוף ----------
function hasLocation(t) {
  return Boolean(t && ((Number.isFinite(t.lat) && Number.isFinite(t.lng)) || String(t.address || "").trim()));
}
function navDestination(t) {
  if (Number.isFinite(t.lat) && Number.isFinite(t.lng)) return { ll: `${t.lat},${t.lng}` };
  return { q: String(t.address || "").trim() };
}
let navTerminalId = null;
let locDraft = null; // { address, lat, lng, accuracy }

window.navTerminal = function (id) {
  const t = currentTerminals.find((x) => x.id === id);
  if (!t) return;
  if (!hasLocation(t)) { window.editLocation(id); return; }
  navTerminalId = id;
  const where = Number.isFinite(t.lat) ? "מיקום מדויק" : String(t.address);
  document.getElementById("navTarget").textContent = `${t.name || id} · ${where}`;
  openSheet("navPanel");
};
function openNav(app) {
  const t = currentTerminals.find((x) => x.id === navTerminalId);
  if (!t) return;
  const d = navDestination(t);
  const url = app === "waze"
    ? (d.ll ? `https://waze.com/ul?ll=${d.ll}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(d.q)}&navigate=yes`)
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(d.ll || d.q)}`;
  closeSheets();
  window.open(url, "_blank", "noopener");
}
document.getElementById("navWazeBtn").addEventListener("click", () => openNav("waze"));
document.getElementById("navGoogleBtn").addEventListener("click", () => openNav("google"));
document.getElementById("navEditBtn").addEventListener("click", () => window.editLocation(navTerminalId));

function renderLocCoords() {
  const el = document.getElementById("locCoords");
  el.textContent = locDraft && Number.isFinite(locDraft.lat)
    ? `📍 מיקום מדויק נשמר: ${locDraft.lat.toFixed(5)}, ${locDraft.lng.toFixed(5)}${locDraft.accuracy ? ` (דיוק כ-${Math.round(locDraft.accuracy)} מ')` : ""}`
    : "אין מיקום מדויק שמור.";
}
window.editLocation = function (id) {
  const t = currentTerminals.find((x) => x.id === id);
  if (!t) return;
  navTerminalId = id;
  locDraft = { address: String(t.address || ""), lat: Number.isFinite(t.lat) ? t.lat : null, lng: Number.isFinite(t.lng) ? t.lng : null, accuracy: null };
  document.getElementById("locTerminalName").textContent = `${t.name || id} (מזהה ${id})`;
  document.getElementById("locAddressInput").value = locDraft.address;
  renderLocCoords();
  openSheet("locationPanel");
};
document.getElementById("locHereBtn").addEventListener("click", () => {
  if (!navigator.geolocation) { alert("הדפדפן לא תומך באיתור מיקום."); return; }
  const btn = document.getElementById("locHereBtn");
  btn.disabled = true;
  btn.textContent = "מאתר מיקום...";
  navigator.geolocation.getCurrentPosition((pos) => {
    locDraft.lat = Number(pos.coords.latitude.toFixed(6));
    locDraft.lng = Number(pos.coords.longitude.toFixed(6));
    locDraft.accuracy = pos.coords.accuracy;
    renderLocCoords();
    btn.disabled = false;
    btn.textContent = "📡 שמור את המיקום המדויק שלי עכשיו";
    showToast("המיקום אותר - לחץ \"שמור מיקום\"");
  }, (err) => {
    btn.disabled = false;
    btn.textContent = "📡 שמור את המיקום המדויק שלי עכשיו";
    alert(err && err.code === 1
      ? "אין הרשאת מיקום. אפשר אותה בהגדרות הדפדפן/הטלפון לאתר הזה ונסה שוב."
      : "לא הצלחנו לאתר מיקום. נסה שוב במקום פתוח.");
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
});
async function saveLocation(data) {
  if (!dataUid || !navTerminalId) return;
  try {
    await db.collection("distributors").doc(dataUid).collection("terminals").doc(navTerminalId).update(data);
    closeSheets();
    showToast("המיקום נשמר ✓");
  } catch (err) {
    alert("שמירת המיקום נכשלה: " + errorHe(err, err && err.message));
  }
}
document.getElementById("locSaveBtn").addEventListener("click", () => {
  const address = document.getElementById("locAddressInput").value.trim().slice(0, 200);
  if (!address && !Number.isFinite(locDraft.lat)) { alert("הזן כתובת או שמור מיקום מדויק."); return; }
  saveLocation({ address: address || null, lat: Number.isFinite(locDraft.lat) ? locDraft.lat : null, lng: Number.isFinite(locDraft.lng) ? locDraft.lng : null, locationAt: Date.now() });
});
document.getElementById("locClearBtn").addEventListener("click", () => {
  if (!confirm("למחוק את המיקום של המסוף?")) return;
  saveLocation({ address: null, lat: null, lng: null, locationAt: Date.now() });
});

// ---------- חבר מביא חבר ----------
function referralLink() {
  return dataUid ? `${SITE_URL}?ref=${encodeURIComponent(dataUid)}` : "";
}
function updateReferralStats(profile = {}) {
  const el = document.getElementById("referralStats");
  if (!el) return;
  const n = Number(profile.referralCount) || 0;
  el.textContent = n
    ? `🎉 ${n} חברים הצטרפו ושילמו דרך הקישור שלך - קיבלת ${n} חודשי מתנה.`
    : "עדיין לא הצטרף אף חבר דרך הקישור שלך.";
}
document.getElementById("toggleReferralBtn").addEventListener("click", () => {
  document.getElementById("referralLinkInput").value = referralLink();
  toggleSheet("referralPanel");
});
document.getElementById("copyReferralBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(referralLink());
    showToast("הקישור הועתק ✓");
  } catch (e) {
    document.getElementById("referralLinkInput").select();
    showToast("סמן והעתק את הקישור");
  }
});
document.getElementById("shareReferralBtn").addEventListener("click", () => {
  const text = "היי, אני עובד עם מערכת לניהול קו כספומטים שמתחברת לכספונט: מחשבת כמה להטעין בכל מסוף ושולחת התראות בוואטסאפ. "
    + "נרשמים דרך הקישור שלי ומקבלים חודש ניסיון חינם, ועוד חודש מתנה אחרי התשלום הראשון:\n" + referralLink();
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
});

document.getElementById("toggleDriversBtn").addEventListener("click", () => {
  toggleSheet("driversPanel");
  loadDrivers().catch(() => {});
});

// ---------- דוחות הטענה ----------

let lastReportRows = [];

// ---------- מגמות ותחזית (מההיסטוריה היומית שהמנוע אוסף) ----------

function localIsoDate(d) {
  return d.toLocaleDateString("en-CA"); // YYYY-MM-DD לפי שעון המכשיר
}

// כמה ימים צריכה להספיק הטענה בביקור הבא (עד הביקור שאחריו), לפי ימי הקו
function coverDaysForNextVisit() {
  const days = [...new Set(routeDays)].sort((a, b) => a - b);
  if (!days.length) return 2;
  const today = new Date().getDay();
  const after = (from) => {
    for (let i = 1; i <= 7; i++) if (days.includes((from + i) % 7)) return (from + i) % 7;
    return from;
  };
  const next = after(today);
  const following = after(next);
  return ((following - next + 7) % 7) || 7;
}

function trendOf(cur, prev) {
  if (!prev || prev <= 0) return { key: "new", label: "—", pct: null };
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct >= 15) return { key: "up", label: `▲ +${pct}%`, pct };
  if (pct <= -15) return { key: "down", label: `▼ ${pct}%`, pct };
  return { key: "flat", label: `● ${pct > 0 ? "+" : ""}${pct}%`, pct };
}

let lastTrends = [];

async function loadTrends() {
  const out = document.getElementById("trendsOutput");
  if (!dataUid) return;
  out.textContent = "טוען...";
  const since = new Date();
  since.setDate(since.getDate() - 28);
  let days;
  try {
    const snap = await db.collection("distributors").doc(dataUid).collection("daily")
      .where("date", ">=", localIsoDate(since)).orderBy("date").get();
    days = snap.docs.map((d) => d.data());
  } catch (err) {
    out.textContent = errorHe(err, "טעינת המגמות נכשלה");
    return;
  }
  const today = localIsoDate(new Date());
  const full = days.filter((d) => d.date < today); // רק ימים שהסתיימו
  if (full.length < 3) {
    out.innerHTML = `⏳ נאספים נתונים (${full.length} ${full.length === 1 ? "יום" : "ימים"} שלמים עד עכשיו).
      תחזית צריכה ויעד מומלץ יופיעו אחרי 3 ימים, והשוואת מגמה (עלייה/ירידה) אחרי שבועיים.`;
    lastTrends = [];
    return;
  }
  const last = full.slice(-7);
  const prev = full.slice(-14, -7);
  const avg = (arr, tid, field) => arr.length
    ? arr.reduce((s, d) => s + Number(((d.terminals || {})[tid] || {})[field] || 0), 0) / arr.length
    : 0;
  const cover = coverDaysForNextVisit();
  const visible = currentTerminals.filter((t) => !t.hidden);

  lastTrends = visible.map((t) => {
    const tid = String(t.id);
    const curW = avg(last, tid, "withdrawn");
    const prevW = avg(prev, tid, "withdrawn");
    const curTx = avg(last, tid, "tx");
    const prevTx = avg(prev, tid, "tx");
    const trend = trendOf(curW, prev.length >= 3 ? prevW : 0);
    const txTrend = trendOf(curTx, prev.length >= 3 ? prevTx : 0);
    const balance = Number(t.balance || 0);
    const daysLeft = curW > 0 ? balance / curW : null;
    const recK = curW > 0 ? Math.max(5, Math.ceil((curW * cover * 1.15) / 5000) * 5) : null;
    return { t, curW, curTx, trend, txTrend, daysLeft, recK };
  }).sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));

  const up = lastTrends.filter((x) => x.trend.key === "up").length;
  const down = lastTrends.filter((x) => x.trend.key === "down").length;
  const flat = lastTrends.filter((x) => x.trend.key === "flat").length;
  const hasCompare = prev.length >= 3;
  const rows = lastTrends.map((x) => {
    const current = hasConfiguredTargetK(x.t) ? `${Number(x.t.baseTargetK)}K` : "לא הוגדר";
    const left = x.daysLeft === null ? "אין משיכות" : x.daysLeft < 1 ? "⚠️ לא יספיק ליום שלם" : `יספיק לעוד ~${x.daysLeft.toFixed(1)} ימים`;
    return `<div class="trend-row trend-${x.trend.key}">
      <div class="trend-top"><b>${escapeHtml(x.t.name || x.t.id)}</b>${hasCompare ? `<span class="trend-badge">${x.trend.label}</span>` : ""}</div>
      <div class="trend-meta">משיכות ₪${formatAmountILS(Math.round(x.curW))} ליום · ${Math.round(x.curTx)} עסקאות ליום${hasCompare && x.txTrend.pct !== null ? ` (${x.txTrend.label})` : ""} · ${left}</div>
      ${x.recK ? `<div class="trend-rec">🎯 יעד מומלץ לביקור הבא: <b>${x.recK}K</b> <span>(מוגדר: ${current} · מכסה ${cover} ימים + 15% ביטחון)</span></div>` : ""}
    </div>`;
  }).join("");
  out.innerHTML = `
    <div class="trend-summary">${hasCompare
      ? `<span class="chip trend-up-chip">▲ ${up} בעלייה</span><span class="chip trend-down-chip">▼ ${down} בירידה</span><span class="chip">● ${flat} יציבים</span>`
      : `<span class="chip">השוואת מגמה תופיע אחרי שבועיים של נתונים (${full.length} ימים כרגע)</span>`}</div>
    ${rows}`;
}

function monthRange(value) {
  const [y, m] = String(value).split("-").map(Number);
  return { start: new Date(y, m - 1, 1).getTime(), end: new Date(y, m, 1).getTime() };
}

async function loadReport() {
  const out = document.getElementById("reportOutput");
  const month = document.getElementById("reportMonthInput").value;
  if (!month || !dataUid) return;
  out.textContent = "טוען...";
  const { start, end } = monthRange(month);
  try {
    const snap = await db.collection("distributors").doc(dataUid).collection("refills")
      .where("at", ">=", start).where("at", "<", end).orderBy("at").get();
    lastReportRows = snap.docs.map((d) => d.data());
  } catch (err) {
    out.textContent = errorHe(err, "טעינת הדוח נכשלה");
    return;
  }
  if (!lastReportRows.length) {
    out.textContent = "אין הטענות רשומות בחודש הזה. (ההיסטוריה נרשמת מרגע העדכון הזה ואילך.)";
    return;
  }
  const total = lastReportRows.reduce((a, r) => a + Number(r.amount || 0), 0);
  const byTerm = {};
  const byDay = {};
  const byDriver = {};
  const packsByDay = {};
  lastReportRows.forEach((r) => {
    const k = r.terminalId;
    byTerm[k] = byTerm[k] || { name: r.terminalName || k, count: 0, sum: 0 };
    byTerm[k].count += 1;
    byTerm[k].sum += Number(r.amount || 0);
    const day = new Date(r.at).toLocaleDateString("he-IL");
    byDay[day] = (byDay[day] || 0) + Number(r.amount || 0);
    packsByDay[day] = (packsByDay[day] || 0) + countPacks5k([r.amount]);
    const who = r.byName || r.byEmail || "—";
    byDriver[who] = (byDriver[who] || 0) + Number(r.amount || 0);
  });
  const termRows = Object.entries(byTerm).sort((a, b) => b[1].sum - a[1].sum)
    .map(([id, v]) => `<tr><td>${escapeHtml(v.name)}</td><td>${escapeHtml(id)}</td><td>${v.count}</td><td>₪${formatAmountILS(v.sum)}</td><td>₪${formatAmountILS(Math.round(v.sum / v.count))}</td></tr>`).join("");
  const dayRows = Object.entries(byDay).map(([d, s]) => `<tr><td>${escapeHtml(d)}</td><td>₪${formatAmountILS(s)}</td><td>${packsByDay[d] || 0}</td></tr>`).join("");
  const driverRows = Object.entries(byDriver).map(([w, s]) => `<tr><td>${escapeHtml(w)}</td><td>₪${formatAmountILS(s)}</td></tr>`).join("");
  out.innerHTML = `
    <div style="color:#111827;font-weight:800;margin:6px 0;">סה"כ הוטען: ₪${formatAmountILS(total)} · ${lastReportRows.length} הטענות · ${countPacks5k(lastReportRows.map((r) => r.amount))} חבילות 5K</div>
    <table class="report-table"><tr><th>מסוף</th><th>מזהה</th><th>הטענות</th><th>סה"כ</th><th>ממוצע להטענה</th></tr>${termRows}</table>
    <table class="report-table"><tr><th>יום</th><th>סה"כ</th><th>חבילות 5K</th></tr>${dayRows}</table>
    <table class="report-table"><tr><th>עובד</th><th>סה"כ</th></tr>${driverRows}</table>`;
}

document.getElementById("loadReportBtn").addEventListener("click", loadReport);
document.getElementById("toggleReportsBtn").addEventListener("click", () => {
  const panel = document.getElementById("reportsPanel");
  toggleSheet("reportsPanel");
  const input = document.getElementById("reportMonthInput");
  if (!input.value) {
    const d = new Date();
    input.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  if (!panel.classList.contains("hidden")) {
    loadReport();
    loadTrends();
  }
});

document.getElementById("exportReportBtn").addEventListener("click", () => {
  if (!lastReportRows.length) { alert("אין נתונים לייצוא - הצג קודם חודש עם הטענות."); return; }
  const csvCell = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@]/.test(s)) s = "'" + s; // מניעת הזרקת נוסחאות באקסל
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [["תאריך", "שעה", "מסוף", "מזהה", "סכום", "יתרה לפני", "עובד", "אימייל"].map(csvCell).join(",")];
  lastReportRows.forEach((r) => {
    const d = new Date(r.at);
    lines.push([d.toLocaleDateString("he-IL"), d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }),
      r.terminalName, r.terminalId, r.amount, r.balanceBefore ?? "", r.byName || "", r.byEmail || ""].map(csvCell).join(","));
  });
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `הטענות-${document.getElementById("reportMonthInput").value}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- בלי קליטה ----------
function updateOnlineBanner() {
  document.getElementById("offlineBanner").classList.toggle("hidden", navigator.onLine);
}
window.addEventListener("online", updateOnlineBanner);
window.addEventListener("offline", updateOnlineBanner);
updateOnlineBanner();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

auth.onAuthStateChanged((user) => {
  currentUser = user;
  if (user) {
    startSession(user);
  } else {
    if (unsubscribeTerminals) unsubscribeTerminals();
    if (unsubscribeCas) unsubscribeCas();
    if (unsubscribeProfile) unsubscribeProfile();
    dataUid = null;
    userRole = "owner";
    document.body.classList.remove("role-driver");
    closeSheets();
    document.getElementById("appSection").classList.add("hidden");
    document.getElementById("authSection").classList.remove("hidden");
  }
});
  
// לחיצות בכרטיסי המסופים (במקום onclick בתוך ה-HTML - מאפשר מדיניות אבטחת תוכן קשיחה)
const CARD_ACTIONS = ["navTerminal", "editLocation", "toggleTerminalSector","togglePaperRoll","editTerminalNote","toggleCompleted","toggleMore","openEditTargetModal","editTerminalThreshold","moveTerminal","toggleHidden"];
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn || !CARD_ACTIONS.includes(btn.dataset.act)) return;
  const fn = window[btn.dataset.act];
  if (typeof fn !== "function") return;
  if (btn.dataset.arg !== undefined) fn(btn.dataset.id, Number(btn.dataset.arg)); else fn(btn.dataset.id);
});
