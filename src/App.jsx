import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, updateDoc, doc, setDoc, onSnapshot, query, orderBy, serverTimestamp, increment, deleteDoc, arrayUnion } from "firebase/firestore";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "firebase/auth";
// ════════════════════════════════════════════
// Firebase 設定 — 請在 firebase.google.com 註冊後貼上你的設定
// ════════════════════════════════════════════
const firebaseConfig = {
  apiKey: "AIzaSyBz2UCtxx5eGbDcgcYg9Iow3xFvzoIn4Ig",
  authDomain: "volleyball-radar.firebaseapp.com",
  projectId: "volleyball-radar",
  storageBucket: "volleyball-radar.firebasestorage.app",
  messagingSenderId: "140812184648",
  appId: "1:140812184648:web:92ea6b8288d93716c6bc7d",
  measurementId: "G-1YHGSNSQN6"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const sessionsRef = collection(db, "sessions");
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
// ════════════════════════════════════════════
// 管理者密碼 — 請改成你自己的密碼（請勿使用預設值）
// 進入方式：網址加上 ?admin=1，例如 https://your-site.vercel.app/?admin=1
// ════════════════════════════════════════════
const ADMIN_PASSWORD = "0912662663";
const ADMIN_SESSION_KEY = "vb_admin_session";

// ════════════════════════════════════════════
// LINE 通知設定 — 部署 Firebase Functions 後填入
// ════════════════════════════════════════════
const FUNCTIONS_BASE_URL = "https://sendlinenotification-njjh4do2yq-uc.a.run.app"; // Firebase Functions URL
const LINE_OA_URL = "https://lin.ee/6SdN1hZ"; // LINE 官方帳號加好友連結
const LINE_USER_KEY = "vb_line_user_id"; // localStorage key for LINE user ID
const WANT_TO_PLAY_HOURS = 6; // 「想打球」狀態維持 6 小時

// Get ISO week string like "2026-W16"
function getCurrentWeek() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

// Calculate stats from weeklyRecords
function calcWinStats(records) {
  if (!records || records.length === 0) return null;
  const sorted = [...records].sort((a, b) => b.week.localeCompare(a.week));
  const totalPlayed = sorted.reduce((s, r) => s + (r.played || 0), 0);
  const totalWon = sorted.reduce((s, r) => s + (r.won || 0), 0);
  const rate = totalPlayed > 0 ? Math.round((totalWon / totalPlayed) * 100) : 0;
  const thisWeek = sorted[0];
  const lastWeek = sorted[1];
  const thisRate = thisWeek && thisWeek.played > 0 ? Math.round((thisWeek.won / thisWeek.played) * 100) : null;
  const lastRate = lastWeek && lastWeek.played > 0 ? Math.round((lastWeek.won / lastWeek.played) * 100) : null;
  const trend = thisRate !== null && lastRate !== null ? (thisRate > lastRate ? "up" : thisRate < lastRate ? "down" : "same") : null;
  return { totalPlayed, totalWon, rate, thisWeek, trend, recent: sorted.slice(0, 8) };
}

// Helper to get date string offset from today
function dayOffset(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

const AREAS_FILTER = ["全部", "大安區", "信義區", "中山區", "松山區", "內湖區", "文山區", "北投區", "士林區"];
const LEVELS = ["全部", "初階", "中階", "中高階", "不限"];
const LEVELS_INPUT = ["初階", "中階", "中高階", "不限"];

// FB volleyball groups — for one-click copy & share
const FB_GROUPS = [
  { name: "排球咖", url: "https://www.facebook.com/groups/186877438033868" },
  { name: "【三重】3.14π球館", url: "https://www.facebook.com/groups/471627857365456" },
];

// Dynamic dates: generate 7 days starting from today
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Check if a string is a valid URL (http/https)
function isValidUrl(str) {
  if (!str || typeof str !== "string") return false;
  const trimmed = str.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
function getDateLabel(offset) {
  if (offset === 0) return "今天";
  if (offset === 1) return "明天";
  if (offset === 2) return "後天";
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `週${weekdays[d.getDay()]}`;
}
function buildDates() {
  const result = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    result.push({ label: getDateLabel(i), value: formatDate(d) });
  }
  return result;
}
function getToday() { return formatDate(new Date()); }
const DATES = buildDates();
const HOURS = [];
for (let h = 6; h <= 23; h++) { for (let m = 0; m < 60; m += 30) { HOURS.push(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`); } }

// Relative time formatter: "剛剛", "3 分鐘前", "2 小時前", "昨天 14:30", "4/16 14:30"
function formatRelativeTime(ts) {
  if (!ts) return "";
  const date = typeof ts === "number" ? new Date(ts) : ts;
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "剛剛";
  if (diff < 3600) return `${Math.floor(diff/60)} 分鐘前`;
  if (diff < 86400) return `${Math.floor(diff/3600)} 小時前`;
  if (diff < 172800) return `昨天 ${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`;
  return `${date.getMonth()+1}/${date.getDate()} ${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`;
}

// Generate FB-share-ready text from session data
function generatePostText(data) {
  // Parse date for nice display with weekday
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  let dateLine = data.date;
  try {
    const [y, mo, d] = data.date.split("-").map(Number);
    const dateObj = new Date(y, mo - 1, d);
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.round((dateObj - today) / 86400000);
    let prefix = "";
    if (diff === 0) prefix = "今天 ";
    else if (diff === 1) prefix = "明天 ";
    else if (diff === 2) prefix = "後天 ";
    dateLine = `${prefix}${mo}/${d}（${weekdays[dateObj.getDay()]}）`;
  } catch {}

  const need = Math.max(0, 12 - Number(data.registered));
  const needLine = need > 0
    ? `還差 ${need} 人就可以開打！`
    : "人數已足，開打沒問題！";

  const lines = [
    `【排球揪團】${data.courtName}`,
    "",
    `📅 日期：${dateLine}`,
    `🕐 時間：${data.time} 開始`,
    `📍 地點：${data.courtName}｜${data.area}`,
    `🏐 程度：${data.level}`,
    `💰 費用：${data.fee} 元／人`,
    "",
    `目前人數：${data.registered}／${data.max}`,
    needLine,
    "",
    `主揪：${data.host}`,
  ];

  if (data.signupUrl && data.signupUrl.trim()) {
    lines.push(`報名：${data.signupUrl.trim()}`);
  }
  if (data.notes && data.notes.trim()) {
    lines.push(`備註：${data.notes.trim()}`);
  }

  lines.push("", "──────", "* 由排球揪團雷達生成");
  return lines.join("\n");
}

function getStatus(session) {
  const { registered, min, max } = session;
  if (registered >= max) return { label: "已滿", color: "#5A7B9A", bg: "rgba(180,165,130,0.18)" };
  if (registered >= min) return { label: "已成團", color: "#7FA87C", bg: "rgba(127,168,124,0.10)" };
  if (registered >= min - 3) return { label: "即將成團", color: "#E89B5E", bg: "rgba(232,155,94,0.10)" };
  return { label: "募集中", color: "#C85A5A", bg: "rgba(200,90,90,0.15)" };
}
function getStatusPriority(s) {
  if (s.registered >= s.max) return 4;
  if (s.registered >= s.min) return 3;
  if (s.registered >= s.min - 3) return 1;
  return 2;
}

/* ── Icons ── */
const VolleyballIcon = () => (<svg width="28" height="28" viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="12" stroke="currentColor" strokeWidth="1.8"/><path d="M14 2C14 2 8 8 8 14C8 20 14 26 14 26" stroke="currentColor" strokeWidth="1.2"/><path d="M14 2C14 2 20 8 20 14C20 20 14 26 14 26" stroke="currentColor" strokeWidth="1.2"/><path d="M3 10H25" stroke="currentColor" strokeWidth="1.2"/><path d="M3 18H25" stroke="currentColor" strokeWidth="1.2"/></svg>);
const FireIcon = () => (<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 16c3.314 0 6-2.686 6-6 0-3.314-4-10-6-10S2 6.686 2 10c0 3.314 2.686 6 6 6zm0-2a2 2 0 100-4 2 2 0 000 4z"/></svg>);
const PersonIcon = () => (<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" opacity="0.7"><path d="M8 8a3 3 0 100-6 3 3 0 000 6zM2 14s0-4 6-4 6 4 6 4H2z"/></svg>);
const PlusIcon = () => (<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="10" y1="4" x2="10" y2="16"/><line x1="4" y1="10" x2="16" y2="10"/></svg>);
const CloseIcon = () => (<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/></svg>);
const EditIcon = () => (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z"/></svg>);
const LockIcon = () => (<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" opacity="0.6"><path d="M8 1a3 3 0 00-3 3v2H4a1 1 0 00-1 1v6a1 1 0 001 1h8a1 1 0 001-1V7a1 1 0 00-1-1h-1V4a3 3 0 00-3-3zm-1.5 3a1.5 1.5 0 113 0v2h-3V4z"/></svg>);
const ChatIcon = () => (<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" opacity="0.8"><path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H6l-3 3V3z"/></svg>);
const ChevronIcon = ({ open }) => (<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}><polyline points="3 4.5 6 7.5 9 4.5"/></svg>);
const ShieldIcon = () => (<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l6 2v4c0 4-3 7-6 8-3-1-6-4-6-8V3l6-2zm-1 6.5L5 6l-1 1 3 3 5-5-1-1-4 3.5z"/></svg>);
const TrashIcon = () => (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="2 4 14 4"/><path d="M12.5 4v9a1 1 0 01-1 1h-7a1 1 0 01-1-1V4"/><path d="M6 4V2a1 1 0 011-1h2a1 1 0 011 1v2"/></svg>);
const MinusIcon = () => (<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="3" y1="6" x2="9" y2="6"/></svg>);
const PlusSmallIcon = () => (<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="6" y1="3" x2="6" y2="9"/><line x1="3" y1="6" x2="9" y2="6"/></svg>);
const CopyIcon = () => (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v7a1 1 0 001 1h2"/></svg>);
const CheckIcon = () => (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 8 6.5 11.5 13 5"/></svg>);
const ShareIcon = () => (<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M12 2.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM2 8a2.5 2.5 0 105 0 2.5 2.5 0 00-5 0zm10 3a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"/><path d="M9.7 6.9L5.3 9.5M9.7 11.1L5.3 8.5" stroke="currentColor" strokeWidth="1" fill="none"/></svg>);
const BellIcon = () => (<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5a4.5 4.5 0 00-4.5 4.5c0 2.5-1 4-1.5 4.5h12c-.5-.5-1.5-2-1.5-4.5A4.5 4.5 0 008 1.5zM6.5 12a1.5 1.5 0 003 0"/></svg>);

/* ── Shared styles ── */
const inputStyle = { width: "100%", padding: "10px 14px", borderRadius: 10, background: "rgba(255,249,236,0.95)", border: "1px solid rgba(180,165,130,0.22)", color: "#1E3A5F", fontSize: 14, outline: "none", transition: "border-color 0.2s", fontFamily: "inherit" };
const labelStyle = { fontSize: 12, color: "#5A7B9A", marginBottom: 6, display: "block", fontWeight: 600, letterSpacing: "0.04em" };

/* ── Progress Ring ── */
const ProgressRing = ({ current, min, max }) => {
  const radius = 28, stroke = 4, nr = radius - stroke, circ = nr * 2 * Math.PI;
  const offset = circ - Math.min(current / max, 1) * circ;
  const minOffset = circ - (min / max) * circ;
  const status = getStatus({ registered: current, min, max });
  const [bumpKey, setBumpKey] = useState(0);
  const prevCurrent = useRef(current);
  useEffect(() => {
    if (prevCurrent.current !== current) {
      setBumpKey(k => k + 1);
      prevCurrent.current = current;
    }
  }, [current]);
  return (
    <div key={bumpKey} style={{ position: "relative", width: radius*2, height: radius*2, flexShrink: 0, animation: bumpKey > 0 ? "ringBump 0.4s ease" : undefined }}>
      <svg width={radius*2} height={radius*2} style={{ transform: "rotate(-90deg)" }}>
        <circle stroke="rgba(180,165,130,0.22)" fill="transparent" strokeWidth={stroke} r={nr} cx={radius} cy={radius}/>
        <circle stroke="rgba(180,165,130,0.35)" fill="transparent" strokeWidth={stroke} strokeDasharray={`2 ${circ-2}`} strokeDashoffset={-minOffset+1} r={nr} cx={radius} cy={radius} strokeLinecap="butt"/>
        <circle stroke={status.color} fill="transparent" strokeWidth={stroke} strokeDasharray={`${circ} ${circ}`} strokeDashoffset={offset} r={nr} cx={radius} cy={radius} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.6s ease" }}/>
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: status.color, fontFamily: "'Space Mono', monospace" }}>{current}</span>
        <span style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 1 }}>/{max}</span>
      </div>
    </div>
  );
};

/* ── Session Card ── */
const SessionCard = ({ session, courtName, area, onJoin, onEdit, onCancel, hasJoined, onAddComment, onWaitlist, onCancelWaitlist, hasWaitlisted, isAdmin, onAdminDelete, onAdminAdjust }) => {
  const status = getStatus(session);
  const need = Math.max(0, session.min - session.registered);
  const isFull = session.registered >= session.max;
  const isFormed = session.registered >= session.min;
  const waitlist = session.waitlist || 0;
  const hasValidUrl = isValidUrl(session.signupUrl);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const comments = session.comments || [];
  const commentCount = comments.length;
  // Sort comments by createdAt descending (newest first)
  const sortedComments = [...comments].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return (
    <div style={{ background: "var(--card-bg)", borderRadius: 16, padding: "20px 22px 20px 26px", border: "1px solid var(--border)", position: "relative", overflow: "hidden", transition: "all 0.25s ease" }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${status.color}55`; e.currentTarget.style.boxShadow = `0 8px 24px ${status.bg}`; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
    >
      {/* Left-side accent bar (bold and tall, more noticeable) */}
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: status.color, opacity: 0.85 }}/>
      {/* Edit button top-right */}
      <button onClick={() => onEdit(session)} title="主揪編輯" style={{ position: "absolute", top: 10, right: 12, background: "rgba(180,165,130,0.12)", border: "1px solid rgba(180,165,130,0.18)", borderRadius: 8, padding: "5px 8px", cursor: "pointer", color: "#8A7F6A", display: "flex", alignItems: "center", gap: 4, fontSize: 11, transition: "all 0.2s" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(232,155,94,0.22)"; e.currentTarget.style.color = "#E89B5E"; e.currentTarget.style.borderColor = "rgba(232,155,94,0.3)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(180,165,130,0.12)"; e.currentTarget.style.color = "#8A7F6A"; e.currentTarget.style.borderColor = "rgba(180,165,130,0.18)"; }}
      ><EditIcon /> 編輯</button>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <ProgressRing current={session.registered} min={session.min} max={session.max}/>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 60 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{courtName}</span>
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: status.bg, color: status.color, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3 }}>
              {!isFormed && !isFull && <FireIcon/>}{status.label}
            </span>
            {hasJoined && (
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "rgba(90,143,168,0.22)", color: "#5A8FA8", fontWeight: 600 }}>✓ 你已報名</span>
            )}
            {hasWaitlisted && (
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "rgba(184,149,111,0.22)", color: "#B8956F", fontWeight: 600 }}>🕐 你在候補中</span>
            )}
            {session.closed && (
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "rgba(200,90,90,0.22)", color: "#C85A5A", fontWeight: 600 }}>🚫 已關閉</span>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "6px 14px", fontSize: 13, color: "var(--text-secondary)", marginBottom: 10 }}>
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>📍 {area}</span>
            <span style={{ whiteSpace: "nowrap" }}>🕐 {session.time} 開始</span>
            <span style={{ whiteSpace: "nowrap" }}>🏐 {session.level}</span>
            <span style={{ whiteSpace: "nowrap" }}>💰 ${session.fee}/人</span>
            <span style={{ gridColumn: "1 / -1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>👤 主揪：{session.host}</span>
          </div>
          {session.notes && <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8, fontStyle: "italic" }}>📝 {session.notes}</div>}
          {hasValidUrl && !hasJoined && !hasWaitlisted && <div style={{ fontSize: 11, marginBottom: 8, color: "#8A7F6A", display: "flex", alignItems: "center", gap: 4 }}>🔗 點擊報名按鈕將前往外部報名頁面</div>}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            {!isFormed && !isFull && <span style={{ fontSize: 13, color: status.color, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}><PersonIcon/> 還差 {need} 人成團</span>}
            {isFormed && !isFull && <span style={{ fontSize: 13, color: "#7FA87C", fontWeight: 500 }}>✅ 已成團，還可加入 {session.max - session.registered} 人</span>}
            {isFull && (
              <span style={{ fontSize: 13, color: "#5A7B9A" }}>
                已額滿{waitlist > 0 && <span style={{ color: "#B8956F", marginLeft: 6 }}>· 候補 {waitlist} 人</span>}
              </span>
            )}
            {hasJoined ? (
              <button onClick={() => onCancel(session.id)}
                style={{ padding: "7px 18px", borderRadius: 10, border: "1px solid rgba(200,90,90,0.35)", background: "rgba(200,90,90,0.15)", color: "#C85A5A", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.2s ease" }}
                onMouseEnter={(e) => { e.target.style.background = "rgba(200,90,90,0.25)"; }}
                onMouseLeave={(e) => { e.target.style.background = "rgba(200,90,90,0.15)"; }}
              >✕ 取消報名</button>
            ) : hasWaitlisted ? (
              <button onClick={() => onCancelWaitlist(session.id)}
                style={{ padding: "7px 18px", borderRadius: 10, border: "1px solid rgba(200,90,90,0.35)", background: "rgba(200,90,90,0.15)", color: "#C85A5A", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.2s ease" }}
                onMouseEnter={(e) => { e.target.style.background = "rgba(200,90,90,0.25)"; }}
                onMouseLeave={(e) => { e.target.style.background = "rgba(200,90,90,0.15)"; }}
              >✕ 取消候補</button>
            ) : isFull ? (
              <button onClick={() => { if (hasValidUrl) { window.open(session.signupUrl, "_blank", "noopener,noreferrer"); } onWaitlist(session.id); }}
                style={{ padding: "7px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #B8956F, #A88B6B)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.2s ease" }}
                onMouseEnter={(e) => { e.target.style.transform = "scale(1.04)"; }}
                onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; }}
              >🕐 我要候補{hasValidUrl ? " ↗" : ""}</button>
            ) : (
              <button onClick={() => { if (hasValidUrl) { window.open(session.signupUrl, "_blank", "noopener,noreferrer"); } onJoin(session.id); }}
                style={{ padding: "7px 20px", borderRadius: 10, border: "none", background: isFormed ? "rgba(127,168,124,0.22)" : `linear-gradient(135deg, ${status.color}, ${status.color}dd)`, color: isFormed ? "#7FA87C" : "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.2s ease" }}
                onMouseEnter={(e) => { e.target.style.transform = "scale(1.04)"; }}
                onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; }}
              >{isFormed ? "+ 我要加入" : "🙋 我要報名"}{hasValidUrl ? " ↗" : ""}</button>
            )}
          </div>

          {/* Admin controls (red bar) */}
          {isAdmin && (
            <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(200,90,90,0.12)", border: "1px solid rgba(200,90,90,0.28)" }}>
              <div style={{ fontSize: 11, color: "#C85A5A", fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
                <ShieldIcon/> 管理者控制
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#5A7B9A" }}>
                  <span>報名：</span>
                  <button onClick={() => onAdminAdjust(session.id, "registered", -1)}
                    style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(180,165,130,0.28)", background: "rgba(255,249,236,0.95)", color: "#1E3A5F", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(200,90,90,0.28)"; e.currentTarget.style.borderColor = "rgba(200,90,90,0.4)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,249,236,0.95)"; e.currentTarget.style.borderColor = "rgba(180,165,130,0.28)"; }}
                  ><MinusIcon/></button>
                  <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, color: "#1E3A5F", minWidth: 20, textAlign: "center" }}>{session.registered}</span>
                  <button onClick={() => onAdminAdjust(session.id, "registered", 1)}
                    style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(180,165,130,0.28)", background: "rgba(255,249,236,0.95)", color: "#1E3A5F", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(127,168,124,0.28)"; e.currentTarget.style.borderColor = "rgba(127,168,124,0.4)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,249,236,0.95)"; e.currentTarget.style.borderColor = "rgba(180,165,130,0.28)"; }}
                  ><PlusSmallIcon/></button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#5A7B9A" }}>
                  <span>候補：</span>
                  <button onClick={() => onAdminAdjust(session.id, "waitlist", -1)}
                    style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(180,165,130,0.28)", background: "rgba(255,249,236,0.95)", color: "#1E3A5F", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(200,90,90,0.28)"; e.currentTarget.style.borderColor = "rgba(200,90,90,0.4)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,249,236,0.95)"; e.currentTarget.style.borderColor = "rgba(180,165,130,0.28)"; }}
                  ><MinusIcon/></button>
                  <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, color: "#1E3A5F", minWidth: 20, textAlign: "center" }}>{session.waitlist || 0}</span>
                  <button onClick={() => onAdminAdjust(session.id, "waitlist", 1)}
                    style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(180,165,130,0.28)", background: "rgba(255,249,236,0.95)", color: "#1E3A5F", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(127,168,124,0.28)"; e.currentTarget.style.borderColor = "rgba(127,168,124,0.4)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,249,236,0.95)"; e.currentTarget.style.borderColor = "rgba(180,165,130,0.28)"; }}
                  ><PlusSmallIcon/></button>
                </div>
                <button onClick={() => onAdminDelete(session)}
                  style={{ marginLeft: "auto", padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(200,90,90,0.4)", background: "rgba(200,90,90,0.18)", color: "#C85A5A", fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, transition: "all 0.2s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(200,90,90,0.28)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(200,90,90,0.18)"; }}
                >
                  <TrashIcon/> 刪除場次
                </button>
              </div>
            </div>
          )}

          {/* Comments section */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed rgba(180,165,130,0.22)" }}>
            <button onClick={() => setCommentsOpen(o => !o)}
              style={{ background: commentCount > 0 ? "rgba(90,143,168,0.10)" : "transparent", border: "none", padding: "6px 10px", borderRadius: 8, cursor: "pointer", color: commentCount > 0 ? "#5A8FA8" : "#8A7F6A", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, width: "100%", justifyContent: "space-between", transition: "all 0.2s" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = commentCount > 0 ? "rgba(90,143,168,0.18)" : "rgba(180,165,130,0.10)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = commentCount > 0 ? "rgba(90,143,168,0.10)" : "transparent"; }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <ChatIcon/>
                {commentCount > 0 ? (
                  <>主揪留言 <span style={{ color: "#5A8FA8", fontWeight: 700 }}>({commentCount})</span></>
                ) : (
                  <span style={{ color: "#8A7F6A" }}>尚無主揪留言</span>
                )}
              </span>
              <ChevronIcon open={commentsOpen}/>
            </button>

            {commentsOpen && (
              <div style={{ marginTop: 10, animation: "fadeIn 0.2s ease" }}>
                {sortedComments.length === 0 && (
                  <div style={{ fontSize: 12, color: "#8A7F6A", padding: "8px 0", textAlign: "center", fontStyle: "italic" }}>
                    還沒有任何主揪留言
                  </div>
                )}
                {sortedComments.map((c, idx) => (
                  <div key={idx} style={{ padding: "10px 12px", marginBottom: 6, borderRadius: 10, background: "rgba(90,143,168,0.08)", border: "1px solid rgba(90,143,168,0.18)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, fontSize: 11, color: "#8A7F6A" }}>
                      <span style={{ fontWeight: 600, color: "#5A8FA8" }}>👤 {c.author || session.host}</span>
                      <span>{formatRelativeTime(c.createdAt)}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{c.text}</div>
                  </div>
                ))}
                <button onClick={() => onAddComment(session)}
                  style={{ width: "100%", marginTop: 6, padding: "8px", borderRadius: 10, border: "1px dashed rgba(90,143,168,0.35)", background: "rgba(90,143,168,0.08)", color: "#5A8FA8", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={(e) => { e.target.style.background = "rgba(90,143,168,0.18)"; }}
                  onMouseLeave={(e) => { e.target.style.background = "rgba(90,143,168,0.08)"; }}
                >+ 我是主揪，我要留言</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const StatBadge = ({ value, label, color }) => {
  const [bumpKey, setBumpKey] = useState(0);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) {
      setBumpKey(k => k + 1);
      prev.current = value;
    }
  }, [value]);
  return (
    <div style={{ textAlign: "center", padding: "12px 16px", borderRadius: 12, background: `${color}0a`, border: `1px solid ${color}22`, minWidth: 80, transition: "all 0.2s" }}>
      <div key={bumpKey} style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "'Space Mono', monospace", animation: bumpKey > 0 ? "ringBump 0.4s ease" : undefined }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2, letterSpacing: "0.04em" }}>{label}</div>
    </div>
  );
};

/* ════════════════════════════════════════════
   Password Prompt Modal
   ════════════════════════════════════════════ */
const PasswordModal = ({ open, onClose, onVerify, sessionId }) => {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => { if (open) { setPw(""); setError(""); setTimeout(() => inputRef.current?.focus(), 100); } }, [open]);

  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(30,58,95,0.25)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 901, width: "min(380px, 90vw)", background: "linear-gradient(180deg, #FFF9EC, #FFF9EC)", borderRadius: 20, border: "1px solid rgba(180,165,130,0.18)", padding: "28px 24px", animation: "fadeIn 0.25s ease", boxShadow: "0 20px 60px rgba(30,58,95,0.20)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <LockIcon/>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: "#1E3A5F" }}>主揪驗證</h3>
        </div>
        <p style={{ fontSize: 13, color: "#8A7F6A", marginBottom: 16, lineHeight: 1.5 }}>請輸入開場時設定的密碼才能編輯此場次</p>
        <input ref={inputRef} type="password" value={pw} onChange={(e) => { setPw(e.target.value); setError(""); }}
          placeholder="輸入密碼"
          style={{ ...inputStyle, borderColor: error ? "#C85A5A" : "rgba(180,165,130,0.22)", marginBottom: error ? 4 : 16 }}
          onFocus={(e) => { e.target.style.borderColor = "#E89B5E"; }}
          onBlur={(e) => { e.target.style.borderColor = error ? "#C85A5A" : "rgba(180,165,130,0.22)"; }}
          onKeyDown={(e) => { if (e.key === "Enter") { const ok = onVerify(sessionId, pw); if (!ok) setError("密碼錯誤，請重新輸入"); } }}
        />
        {error && <div style={{ fontSize: 12, color: "#C85A5A", marginBottom: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(180,165,130,0.28)", background: "transparent", color: "#5A7B9A", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>取消</button>
          <button onClick={() => { const ok = onVerify(sessionId, pw); if (!ok) setError("密碼錯誤，請重新輸入"); }}
            style={{ flex: 1, padding: "12px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #E89B5E, #D4855F)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
            onMouseEnter={(e) => { e.target.style.transform = "scale(1.02)"; }}
            onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; }}
          >確認</button>
        </div>
      </div>
    </>
  );
};

/* ════════════════════════════════════════════
   Comment Modal — verify password then post
   ════════════════════════════════════════════ */
const CommentModal = ({ open, onClose, session, onSubmit }) => {
  const [pw, setPw] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);
  const pwRef = useRef(null);
  const textRef = useRef(null);

  useEffect(() => {
    if (open) {
      setPw(""); setText(""); setError(""); setVerified(false);
      setTimeout(() => pwRef.current?.focus(), 100);
    }
  }, [open]);

  if (!open || !session) return null;

  const tryVerify = () => {
    if (pw === session.password) {
      setVerified(true);
      setError("");
      setTimeout(() => textRef.current?.focus(), 100);
    } else {
      setError("密碼錯誤，請重新輸入");
    }
  };

  const handleSubmit = async () => {
    if (!text.trim()) { setError("留言內容不能為空"); return; }
    if (text.length > 500) { setError("留言不能超過 500 字"); return; }
    await onSubmit(session.id, text.trim(), session.host);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(30,58,95,0.25)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 901, width: "min(420px, 92vw)", background: "linear-gradient(180deg, #FFF9EC, #FFF9EC)", borderRadius: 20, border: "1px solid rgba(180,165,130,0.18)", padding: "28px 24px", animation: "fadeIn 0.25s ease", boxShadow: "0 20px 60px rgba(30,58,95,0.20)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <ChatIcon/>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: "#1E3A5F" }}>主揪留言</h3>
        </div>
        <p style={{ fontSize: 12, color: "#8A7F6A", marginBottom: 16, lineHeight: 1.5 }}>
          {verified ? `以「${session.host}」的身份發佈留言` : "請先輸入密碼驗證主揪身份"}
        </p>

        {!verified ? (
          <>
            <input ref={pwRef} type="password" value={pw} onChange={(e) => { setPw(e.target.value); setError(""); }}
              placeholder="輸入密碼"
              style={{ ...inputStyle, borderColor: error ? "#C85A5A" : "rgba(180,165,130,0.22)", marginBottom: error ? 4 : 16 }}
              onFocus={(e) => { e.target.style.borderColor = "#E89B5E"; }}
              onBlur={(e) => { e.target.style.borderColor = error ? "#C85A5A" : "rgba(180,165,130,0.22)"; }}
              onKeyDown={(e) => { if (e.key === "Enter") tryVerify(); }}
            />
            {error && <div style={{ fontSize: 12, color: "#C85A5A", marginBottom: 12 }}>{error}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(180,165,130,0.28)", background: "transparent", color: "#5A7B9A", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>取消</button>
              <button onClick={tryVerify}
                style={{ flex: 1, padding: "12px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #E89B5E, #D4855F)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
              >驗證</button>
            </div>
          </>
        ) : (
          <>
            <textarea ref={textRef} value={text} onChange={(e) => { setText(e.target.value); setError(""); }}
              placeholder="例如：已湊到 10 人，再 2 人就可以打了！或：因下雨延到明天同時段，請大家注意..."
              rows={4}
              style={{ ...inputStyle, resize: "vertical", minHeight: 100, borderColor: error ? "#C85A5A" : "rgba(180,165,130,0.22)", marginBottom: error ? 4 : 10 }}
              onFocus={(e) => { e.target.style.borderColor = "#E89B5E"; }}
              onBlur={(e) => { e.target.style.borderColor = error ? "#C85A5A" : "rgba(180,165,130,0.22)"; }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8A7F6A", marginBottom: 14 }}>
              <span>{error && <span style={{ color: "#C85A5A" }}>{error}</span>}</span>
              <span style={{ color: text.length > 500 ? "#C85A5A" : "#8A7F6A" }}>{text.length} / 500</span>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(180,165,130,0.28)", background: "transparent", color: "#5A7B9A", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>取消</button>
              <button onClick={handleSubmit}
                style={{ flex: 2, padding: "12px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #5A8FA8, #3D6B80)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={(e) => { e.target.style.transform = "scale(1.02)"; e.target.style.boxShadow = "0 4px 20px rgba(90,143,168,0.35)"; }}
                onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; e.target.style.boxShadow = "none"; }}
              >💬 發佈留言</button>
            </div>
          </>
        )}
      </div>
    </>
  );
};

/* ════════════════════════════════════════════
   Admin Login Modal
   ════════════════════════════════════════════ */
const AdminLoginModal = ({ open, onClose, onLogin }) => {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => { if (open) { setPw(""); setError(""); setTimeout(() => inputRef.current?.focus(), 100); } }, [open]);

  if (!open) return null;

  const tryLogin = () => {
    if (pw === ADMIN_PASSWORD) {
      onLogin();
    } else {
      setError("管理者密碼錯誤");
    }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(30,58,95,0.35)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 901, width: "min(380px, 90vw)", background: "linear-gradient(180deg, #FDE9E9, #F8DADA)", borderRadius: 20, border: "1px solid rgba(200,90,90,0.35)", padding: "28px 24px", animation: "fadeIn 0.25s ease", boxShadow: "0 20px 60px rgba(200,90,90,0.28)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, color: "#C85A5A" }}>
          <ShieldIcon/>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: "#C85A5A" }}>管理者登入</h3>
        </div>
        <p style={{ fontSize: 12, color: "#5A7B9A", marginBottom: 16, lineHeight: 1.5 }}>
          此為高權限模式，可刪除、編輯任何場次。請輸入管理者密碼。
        </p>
        <input ref={inputRef} type="password" value={pw} onChange={(e) => { setPw(e.target.value); setError(""); }}
          placeholder="管理者密碼"
          style={{ ...inputStyle, borderColor: error ? "#C85A5A" : "rgba(200,90,90,0.35)", marginBottom: error ? 4 : 16 }}
          onFocus={(e) => { e.target.style.borderColor = "#C85A5A"; }}
          onBlur={(e) => { e.target.style.borderColor = error ? "#C85A5A" : "rgba(200,90,90,0.35)"; }}
          onKeyDown={(e) => { if (e.key === "Enter") tryLogin(); }}
        />
        {error && <div style={{ fontSize: 12, color: "#C85A5A", marginBottom: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(180,165,130,0.28)", background: "transparent", color: "#5A7B9A", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>取消</button>
          <button onClick={tryLogin}
            style={{ flex: 1, padding: "12px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #C85A5A, #A84040)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
            onMouseEnter={(e) => { e.target.style.transform = "scale(1.02)"; }}
            onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; }}
          >登入</button>
        </div>
      </div>
    </>
  );
};

/* ════════════════════════════════════════════
   Share Modal — FB post generator
   ════════════════════════════════════════════ */
const ShareModal = ({ open, onClose, data, onNotifyWantToPlay, wantToPlayCount }) => {
  const [copied, setCopied] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [text, setText] = useState("");
  const [notifySent, setNotifySent] = useState(false);
  const [notifyResult, setNotifyResult] = useState(null);
  const [notifying, setNotifying] = useState(false);

  useEffect(() => {
    if (open && data) {
      setText(generatePostText(data));
      setCopied(false);
      setSelectedGroup("");
      setCustomUrl("");
      setNotifySent(false);
      setNotifyResult(null);
      setNotifying(false);
    }
  }, [open, data]);

  if (!open || !data) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
      document.body.removeChild(ta);
    }
  };

  const getTargetUrl = () => {
    if (selectedGroup === "custom") return customUrl.trim();
    return selectedGroup;
  };

  const handleOpenFb = () => {
    const url = getTargetUrl();
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const canOpen = (selectedGroup && selectedGroup !== "custom") || (selectedGroup === "custom" && isValidUrl(customUrl));

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(30,58,95,0.30)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 901, width: "min(520px, 94vw)", maxHeight: "92vh", overflowY: "auto", background: "linear-gradient(180deg, #FFF9EC, #FFF9EC)", borderRadius: 20, border: "1px solid rgba(90,143,168,0.28)", padding: "28px 24px", animation: "fadeIn 0.25s ease", boxShadow: "0 20px 60px rgba(30,58,95,0.20)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>🎉</span>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1E3A5F" }}>場次已發佈！</h3>
        </div>
        <p style={{ fontSize: 13, color: "#5A7B9A", marginBottom: 18, lineHeight: 1.5 }}>
          幫你準備好了揪團文字，複製後可直接貼到 FB 社團發文。
        </p>

        {/* Text preview */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 6, fontWeight: 600, letterSpacing: "0.04em" }}>📝 揪團文字預覽（可編輯）</div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={14}
            style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "rgba(255,249,236,0.95)", border: "1px solid rgba(180,165,130,0.28)", color: "#1E3A5F", fontSize: 13, lineHeight: 1.7, fontFamily: "'Noto Sans TC', monospace", resize: "vertical", minHeight: 200, outline: "none", boxSizing: "border-box" }}
            onFocus={(e) => { e.target.style.borderColor = "#5A8FA8"; }}
            onBlur={(e) => { e.target.style.borderColor = "rgba(180,165,130,0.28)"; }}
          />
        </div>

        {/* Copy button */}
        <button onClick={handleCopy}
          style={{ width: "100%", padding: "12px", borderRadius: 12, border: "none", background: copied ? "linear-gradient(135deg, #7FA87C, #5B7A59)" : "linear-gradient(135deg, #5A8FA8, #3D6B80)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 18, transition: "all 0.2s" }}
          onMouseEnter={(e) => { if (!copied) e.target.style.transform = "scale(1.02)"; }}
          onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; }}
        >
          {copied ? <><CheckIcon/> 已複製到剪貼簿！</> : <><CopyIcon/> 複製文字</>}
        </button>

        {/* FB group selector */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 6, fontWeight: 600, letterSpacing: "0.04em" }}>📢 選擇要發佈的 FB 社團</div>
          <select value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 10, background: "rgba(255,249,236,0.95)", border: "1px solid rgba(180,165,130,0.28)", color: "#1E3A5F", fontSize: 13, cursor: "pointer", outline: "none" }}
          >
            <option value="">-- 請選擇社團 --</option>
            {FB_GROUPS.map(g => <option key={g.url} value={g.url}>{g.name}</option>)}
            <option value="custom">📌 自訂連結</option>
          </select>

          {selectedGroup === "custom" && (
            <input type="text" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="貼上 FB 社團網址..."
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, background: "rgba(255,249,236,0.95)", border: "1px solid", borderColor: customUrl && !isValidUrl(customUrl) ? "#C85A5A" : "rgba(180,165,130,0.28)", color: "#1E3A5F", fontSize: 13, marginTop: 8, outline: "none", boxSizing: "border-box" }}
              onFocus={(e) => { if (!customUrl || isValidUrl(customUrl)) e.target.style.borderColor = "#5A8FA8"; }}
              onBlur={(e) => { e.target.style.borderColor = customUrl && !isValidUrl(customUrl) ? "#C85A5A" : "rgba(180,165,130,0.28)"; }}
            />
          )}
          {selectedGroup === "custom" && customUrl && !isValidUrl(customUrl) && (
            <div style={{ fontSize: 11, color: "#C85A5A", marginTop: 4 }}>⚠️ 請輸入有效的網址（http:// 或 https:// 開頭）</div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(180,165,130,0.28)", background: "transparent", color: "#5A7B9A", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>稍後再說</button>
          <button onClick={handleOpenFb} disabled={!canOpen}
            style={{ flex: 2, padding: "12px", borderRadius: 12, border: "none", background: canOpen ? "linear-gradient(135deg, #3D6B80, #2D5460)" : "rgba(180,165,130,0.15)", color: canOpen ? "#fff" : "#8A7F6A", fontSize: 14, fontWeight: 700, cursor: canOpen ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.2s" }}
            onMouseEnter={(e) => { if (canOpen) e.target.style.transform = "scale(1.02)"; }}
            onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; }}
          >🔗 前往 FB 社團貼文</button>
        </div>

        <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: "rgba(232,155,94,0.15)", border: "1px solid rgba(232,155,94,0.25)", fontSize: 11, color: "#E89B5E", lineHeight: 1.5 }}>
          💡 <strong>小提示：</strong>按「複製文字」→ 再按「前往 FB 社團貼文」→ 在 FB 社團點發文並貼上即可。
        </div>

        {/* Notify wanting-to-play players via LINE */}
        <div style={{ marginTop: 12, padding: "14px 16px", borderRadius: 12, background: "rgba(91,156,96,0.12)", border: "1px solid rgba(91,156,96,0.28)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#5B9C60", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            📣 通知 LINE 好友有新場次
            {wantToPlayCount > 0 && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(127,168,124,0.25)", color: "#7FA87C" }}>🟢 {wantToPlayCount} 人想打球</span>}
          </div>
          <p style={{ fontSize: 11, color: "#8A7F6A", marginBottom: 10, lineHeight: 1.5 }}>
            透過 LINE 通知所有加了官方帳號的好友，讓他們知道有新場次可以報名。
          </p>
          {notifyResult && (
            <div style={{ marginBottom: 8, padding: "8px 10px", borderRadius: 8, background: notifyResult.error ? "rgba(200,90,90,0.15)" : "rgba(91,156,96,0.15)", fontSize: 12, color: notifyResult.error ? "#C85A5A" : "#5B9C60", fontWeight: 600 }}>
              {notifyResult.error ? `❌ ${notifyResult.error}` : `✅ ${notifyResult.message}`}
            </div>
          )}
          <button
            onClick={async () => {
              if (notifySent) return;
              setNotifying(true);
              const r = await onNotifyWantToPlay(data);
              setNotifyResult(r);
              setNotifySent(true);
              setNotifying(false);
            }}
            disabled={notifySent || notifying}
            style={{ width: "100%", padding: "10px", borderRadius: 10, border: "none", background: notifySent ? "rgba(180,165,130,0.15)" : notifying ? "rgba(91,156,96,0.28)" : "linear-gradient(135deg, #5B9C60, #467A4B)", color: notifySent ? "#8A7F6A" : "#fff", fontSize: 13, fontWeight: 700, cursor: notifySent ? "not-allowed" : "pointer", transition: "all 0.2s" }}
          >{notifySent ? "✅ 已通知" : notifying ? "發送中..." : "📣 發送 LINE 通知"}</button>
        </div>
      </div>
    </>
  );
};

/* ════════════════════════════════════════════
   Notify Modal — send LINE notification
   ════════════════════════════════════════════ */
const NotifyModal = ({ open, onClose, session, onSend }) => {
  const [notifyType, setNotifyType] = useState("formed");
  const [customMessage, setCustomMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open) { setNotifyType("formed"); setCustomMessage(""); setSending(false); setResult(null); }
  }, [open]);

  if (!open || !session) return null;

  const handleSend = async () => {
    setSending(true);
    setResult(null);
    const r = await onSend(session.id, notifyType, customMessage, session.password);
    setResult(r);
    setSending(false);
  };

  const types = [
    { value: "formed", label: "🎉 成團通知", desc: "告訴大家這場已經成團了！" },
    { value: "full", label: "📢 滿團通知", desc: "告訴大家這場已經額滿" },
    { value: "custom", label: "✏️ 自訂訊息", desc: "例如：改期、場地更換、提醒攜帶..." },
  ];

  const isCustom = notifyType === "custom";

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(30,58,95,0.30)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 901, width: "min(480px, 94vw)", maxHeight: "92vh", overflowY: "auto", background: "linear-gradient(180deg, #FFF9EC, #FFF9EC)", borderRadius: 20, border: "1px solid rgba(91,156,96,0.3)", padding: "28px 24px", animation: "fadeIn 0.25s ease", boxShadow: "0 20px 60px rgba(30,58,95,0.20)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <BellIcon/>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1E3A5F" }}>LINE 通知</h3>
        </div>
        <p style={{ fontSize: 12, color: "#5A7B9A", marginBottom: 16, lineHeight: 1.5 }}>
          發送 LINE 訊息給此場次已綁定的報名者
          <span style={{ display: "block", marginTop: 6, color: (2 - (session.notifyCount || 0)) <= 0 ? "#C85A5A" : "#E89B5E", fontWeight: 600 }}>
            📢 剩餘通知次數：{Math.max(0, 2 - (session.notifyCount || 0))} / 2
          </span>
        </p>

        {/* Notify type selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {types.map(t => (
            <label key={t.value} onClick={() => setNotifyType(t.value)}
              style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid", borderColor: notifyType === t.value ? "#5B9C60" : "rgba(180,165,130,0.22)", background: notifyType === t.value ? "rgba(91,156,96,0.15)" : "transparent", cursor: "pointer", transition: "all 0.2s" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: notifyType === t.value ? "#5B9C60" : "#1E3A5F", marginBottom: 2 }}>{t.label}</div>
              <div style={{ fontSize: 11, color: "#8A7F6A" }}>{t.desc}</div>
            </label>
          ))}
        </div>

        {/* Custom message input */}
        {isCustom && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 6, fontWeight: 600, letterSpacing: "0.04em" }}>✏️ 自訂訊息內容</div>
            <textarea value={customMessage} onChange={(e) => setCustomMessage(e.target.value)}
              placeholder="例如：因為下雨，今晚場次延到明天同一時間，請大家注意！"
              rows={4}
              style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "rgba(255,249,236,0.95)", border: "1px solid rgba(180,165,130,0.28)", color: "#1E3A5F", fontSize: 13, lineHeight: 1.6, resize: "vertical", minHeight: 80, outline: "none", boxSizing: "border-box", fontFamily: "'Noto Sans TC', sans-serif" }}
              onFocus={(e) => { e.target.style.borderColor = "#5B9C60"; }}
              onBlur={(e) => { e.target.style.borderColor = "rgba(180,165,130,0.28)"; }}
            />
            <div style={{ fontSize: 11, color: "#8A7F6A", marginTop: 4, textAlign: "right" }}>{customMessage.length} / 500</div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div style={{ marginBottom: 14, padding: "12px", borderRadius: 10, background: result.error ? "rgba(200,90,90,0.15)" : "rgba(91,156,96,0.15)", border: `1px solid ${result.error ? "rgba(200,90,90,0.35)" : "rgba(91,156,96,0.3)"}`, fontSize: 13, color: result.error ? "#C85A5A" : "#5B9C60", fontWeight: 600 }}>
            {result.error
              ? `❌ 發送失敗：${result.error}`
              : `✅ ${result.message}`}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(180,165,130,0.28)", background: "transparent", color: "#5A7B9A", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>取消</button>
          <button onClick={handleSend} disabled={sending || (isCustom && !customMessage.trim()) || (2 - (session.notifyCount || 0)) <= 0}
            style={{ flex: 2, padding: "12px", borderRadius: 12, border: "none", background: (sending || (2 - (session.notifyCount || 0)) <= 0) ? "rgba(180,165,130,0.22)" : "linear-gradient(135deg, #5B9C60, #467A4B)", color: (sending || (2 - (session.notifyCount || 0)) <= 0) ? "#8A7F6A" : "#fff", fontSize: 14, fontWeight: 700, cursor: (sending || (2 - (session.notifyCount || 0)) <= 0) ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.2s" }}
          >
            {(2 - (session.notifyCount || 0)) <= 0 ? "已達通知上限" : sending ? "發送中..." : "📣 發送通知"}
          </button>
        </div>

        <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: "rgba(90,143,168,0.12)", border: "1px solid rgba(90,143,168,0.25)", fontSize: 11, color: "#8A7F6A", lineHeight: 1.6 }}>
          💡 通知只會發送給此場次有綁定 LINE 的報名者（目前 <strong style={{ color: "#5B9C60" }}>{(session.lineUserIds || []).length}</strong> 人已綁定）。報名者需要在報名後輸入綁定碼才能收到通知。
        </div>
      </div>
    </>
  );
};

/* ════════════════════════════════════════════
   Binding Code Modal — show after registration
   ════════════════════════════════════════════ */
const BindingCodeModal = ({ open, onClose, code }) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (open) setCopied(false); }, [open]);

  if (!open || !code) return null;

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(code); } catch {
      const ta = document.createElement("textarea"); ta.value = code; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch {} document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(30,58,95,0.30)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 901, width: "min(400px, 92vw)", background: "linear-gradient(180deg, #FFF9EC, #FFF9EC)", borderRadius: 20, border: "1px solid rgba(91,156,96,0.3)", padding: "28px 24px", animation: "fadeIn 0.25s ease", boxShadow: "0 20px 60px rgba(30,58,95,0.20)", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
        <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1E3A5F", marginBottom: 6 }}>報名成功！</h3>
        <p style={{ fontSize: 13, color: "#5A7B9A", marginBottom: 20, lineHeight: 1.6 }}>
          請記得到主揪的報名頁面 +1，待主揪確認後才算報名成功。<br/>
          如果想收到 LINE 通知（成團、改期等），請完成以下綁定：
        </p>

        {/* Step 1 */}
        <div style={{ textAlign: "left", marginBottom: 16, padding: "14px 16px", borderRadius: 12, background: "rgba(91,156,96,0.12)", border: "1px solid rgba(91,156,96,0.28)" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#5B9C60", marginBottom: 8 }}>Step 1：加 LINE 官方帳號好友</div>
          <a href={LINE_OA_URL} target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: "#5B9C60", color: "#fff", fontSize: 13, fontWeight: 700, textDecoration: "none" }}
          >加入好友 →</a>
          <div style={{ fontSize: 11, color: "#8A7F6A", marginTop: 6 }}>如果已經加過好友可跳過此步驟</div>
        </div>

        {/* Step 2 */}
        <div style={{ textAlign: "left", marginBottom: 20, padding: "14px 16px", borderRadius: 12, background: "rgba(90,143,168,0.12)", border: "1px solid rgba(90,143,168,0.28)" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#5A8FA8", marginBottom: 10 }}>Step 2：在 LINE 聊天室輸入以下綁定碼</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: 32, fontWeight: 900, letterSpacing: "0.2em", fontFamily: "'Space Mono', monospace", color: "#1E3A5F", background: "rgba(255,249,236,0.95)", padding: "8px 20px", borderRadius: 10, border: "1px solid rgba(180,165,130,0.28)" }}>{code}</span>
            <button onClick={handleCopy}
              style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: copied ? "#7FA87C" : "#5A8FA8", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
            >{copied ? "✓ 已複製" : "複製"}</button>
          </div>
          <div style={{ fontSize: 11, color: "#8A7F6A" }}>綁定碼有效期限 24 小時</div>
        </div>

        <button onClick={onClose}
          style={{ width: "100%", padding: "14px", borderRadius: 14, border: "none", background: "linear-gradient(135deg, #E89B5E, #D4855F)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
        >知道了</button>
      </div>
    </>
  );
};

/* ════════════════════════════════════════════
   Edit Session Modal (all fields)
   ════════════════════════════════════════════ */
const EditSessionModal = ({ open, onClose, session, courtName, area, onSave, onCloseSession, onShare, onNotify }) => {
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (open && session) {
      const st = (session.time || "19:00").split("\u2013")[0];
      setForm({
        courtName: courtName || "", area: area || "",
        date: session.date, startTime: st,
        currentPeople: String(session.registered), maxPeople: String(session.max),
        level: session.level, fee: String(session.fee),
        hostName: session.host, signupUrl: session.signupUrl || "", notes: session.notes || "",
      });
      setErrors({});
    }
  }, [open, session]);

  const handleSave = () => {
    const e = {};
    if (!form.courtName.trim()) e.courtName = "請輸入場地名稱";
    if (!form.area.trim()) e.area = "請輸入地區";
    if (!form.hostName.trim()) e.hostName = "請輸入你的名稱";
    if (!form.fee || Number(form.fee) <= 0) e.fee = "請輸入費用";
    if (Number(form.currentPeople) < 0) e.currentPeople = "人數不能小於 0";
    if (Number(form.maxPeople) < 12) e.maxPeople = "上限至少12人";
    if (Number(form.currentPeople) > Number(form.maxPeople)) e.currentPeople = "不能超過上限人數";
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    onSave(session.id, {
      courtName: form.courtName.trim(), area: form.area.trim(),
      date: form.date, time: form.startTime,
      registered: Number(form.currentPeople), max: Number(form.maxPeople),
      level: form.level, fee: Number(form.fee),
      host: form.hostName.trim(), signupUrl: form.signupUrl.trim(), notes: form.notes.trim(),
    });
  };

  if (!open || !session) return null;

  const F = ({ label, field, placeholder, type, min, max, step, err }) => (
    <div style={{ flex: 1, minWidth: type === "number" ? 0 : undefined }}>
      <label style={labelStyle}>{label}</label>
      {type === "select-level" ? (
        <select value={form[field]} onChange={(e) => setForm({...form, [field]: e.target.value})} style={{...inputStyle, cursor: "pointer"}}>
          {LEVELS_INPUT.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      ) : type === "select-hours" ? (
        <select value={form[field]} onChange={(e) => setForm({...form, [field]: e.target.value})} style={{...inputStyle, cursor: "pointer"}}>
          {HOURS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      ) : type === "select-date" ? (
        <select value={form[field]} onChange={(e) => setForm({...form, [field]: e.target.value})} style={{...inputStyle, cursor: "pointer"}}>
          {DATES.map(d => <option key={d.value} value={d.value}>{d.label} ({d.value.slice(5).replace("-","/")})</option>)}
        </select>
      ) : type === "textarea" ? (
        <textarea value={form[field] || ""} onChange={(e) => setForm({...form, [field]: e.target.value})} placeholder={placeholder} rows={2} style={{...inputStyle, resize: "vertical", minHeight: 56, borderColor: err ? "#C85A5A" : "rgba(180,165,130,0.22)"}} onFocus={(e)=>{e.target.style.borderColor="#E89B5E";}} onBlur={(e)=>{e.target.style.borderColor=err?"#C85A5A":"rgba(180,165,130,0.22)";}}/>
      ) : (
        <input type={type||"text"} min={min} max={max} step={step} value={form[field]||""} onChange={(e) => setForm({...form, [field]: e.target.value})} placeholder={placeholder}
          style={{...inputStyle, borderColor: err ? "#C85A5A" : "rgba(180,165,130,0.22)"}}
          onFocus={(e)=>{e.target.style.borderColor="#E89B5E";}} onBlur={(e)=>{e.target.style.borderColor=err?"#C85A5A":"rgba(180,165,130,0.22)";}}
        />
      )}
      {err && <span style={{ fontSize: 11, color: "#C85A5A", marginTop: 4, display: "block" }}>{err}</span>}
    </div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(30,58,95,0.25)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 901, maxHeight: "92vh", overflowY: "auto", background: "linear-gradient(180deg, #FFF9EC, #FFF9EC)", borderRadius: "24px 24px 0 0", border: "1px solid rgba(180,165,130,0.18)", borderBottom: "none", animation: "slideUpModal 0.35s cubic-bezier(0.16,1,0.3,1)", boxShadow: "0 -10px 60px rgba(30,58,95,0.20)" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}><div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(180,165,130,0.35)" }}/></div>
        <div style={{ padding: "8px 24px 32px", maxWidth: 520, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#E89B5E" }}>✏️ 編輯場次</h2>
            <button onClick={onClose} style={{ background: "rgba(180,165,130,0.15)", border: "none", borderRadius: 10, padding: 8, cursor: "pointer", color: "#5A7B9A", display: "flex" }}><CloseIcon/></button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <F label="場地名稱 *" field="courtName" placeholder="場地名稱" err={errors.courtName}/>
            <F label="地區 *" field="area" placeholder="例：大安區" err={errors.area}/>
            <F label="主揪名稱 *" field="hostName" placeholder="暱稱" err={errors.hostName}/>

            <div style={{ display: "flex", gap: 12 }}>
              <F label="日期 *" field="date" type="select-date"/>
              <F label="開始時間 *" field="startTime" type="select-hours"/>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <F label="目前人數 *" field="currentPeople" type="number" min="0" max="24" err={errors.currentPeople}/>
              <F label="人數上限 *" field="maxPeople" type="number" min="12" max="24" err={errors.maxPeople}/>
            </div>

            {Number(form.currentPeople) >= 0 && Number(form.currentPeople) < 12 && (
              <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(232,155,94,0.15)", border: "1px solid rgba(232,155,94,0.25)", fontSize: 13, color: "#E89B5E" }}>
                🔥 還差 <strong>{12 - Number(form.currentPeople)}</strong> 人可以成團
              </div>
            )}

            <div style={{ display: "flex", gap: 12 }}>
              <F label="程度 *" field="level" type="select-level"/>
              <F label="每人費用 (NT$) *" field="fee" type="number" min="0" step="10" placeholder="150" err={errors.fee}/>
            </div>

            <div>
              <label style={labelStyle}>報名連結（選填）</label>
              <input value={form.signupUrl || ""} onChange={(e) => setForm({...form, signupUrl: e.target.value})} placeholder="https://..."
                style={{
                  ...inputStyle,
                  borderColor: form.signupUrl && !isValidUrl(form.signupUrl) ? "#C85A5A" : (form.signupUrl && isValidUrl(form.signupUrl) ? "#7FA87C" : "rgba(180,165,130,0.22)")
                }}
                onFocus={(e)=>{ if (!form.signupUrl) e.target.style.borderColor = "#E89B5E"; }}
                onBlur={(e)=>{ e.target.style.borderColor = form.signupUrl && !isValidUrl(form.signupUrl) ? "#C85A5A" : (form.signupUrl && isValidUrl(form.signupUrl) ? "#7FA87C" : "rgba(180,165,130,0.22)"); }}
              />
              {form.signupUrl && !isValidUrl(form.signupUrl) ? (
                <span style={{ fontSize: 11, color: "#C85A5A", marginTop: 4, display: "block" }}>⚠️ 這不是有效的網址，請以 http:// 或 https:// 開頭（留空也 OK）</span>
              ) : form.signupUrl && isValidUrl(form.signupUrl) ? (
                <span style={{ fontSize: 11, color: "#7FA87C", marginTop: 4, display: "block" }}>✓ 網址格式正確</span>
              ) : (
                <span style={{ fontSize: 11, color: "#8A7F6A", marginTop: 4, display: "block" }}>貼上 FB 社團、LINE 群組或其他報名頁面的網址</span>
              )}
            </div>

            <F label="備註（選填）" field="notes" type="textarea" placeholder="例：需自備球鞋..."/>

            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button onClick={onClose} style={{ flex: 1, padding: "14px", borderRadius: 14, border: "1px solid rgba(180,165,130,0.28)", background: "transparent", color: "#5A7B9A", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>取消</button>
              <button onClick={handleSave}
                style={{ flex: 2, padding: "14px", borderRadius: 14, border: "none", background: "linear-gradient(135deg, #E89B5E, #D4855F)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={(e) => { e.target.style.transform = "scale(1.02)"; e.target.style.boxShadow = "0 4px 20px rgba(232,155,94,0.3)"; }}
                onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; e.target.style.boxShadow = "none"; }}
              >💾 儲存變更</button>
            </div>

            {/* Share to FB section */}
            <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
              <button
                onClick={() => onShare && onShare({ ...form, courtName: form.courtName, area: form.area, date: form.date, time: form.time, registered: Number(form.registered), max: Number(form.max), level: form.level, fee: Number(form.fee), host: form.host, signupUrl: form.signupUrl, notes: form.notes })}
                style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(90,143,168,0.35)", background: "rgba(90,143,168,0.15)", color: "#5A8FA8", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(90,143,168,0.25)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(90,143,168,0.15)"; }}
              >🔗 分享到 FB</button>
              <button
                onClick={() => onNotify && onNotify(session)}
                style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(91,156,96,0.3)", background: "rgba(91,156,96,0.15)", color: "#5B9C60", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(91,156,96,0.25)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(91,156,96,0.15)"; }}
              >📣 LINE 通知</button>
            </div>

            {/* Danger zone — close session */}
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px dashed rgba(200,90,90,0.25)" }}>
              <div style={{ fontSize: 11, color: "#8A7F6A", marginBottom: 8, letterSpacing: "0.04em" }}>危險區域</div>
              <button
                onClick={() => {
                  if (window.confirm("確定要關閉這個場次嗎？\n關閉後場次會立刻從列表中隱藏，資料仍會保留但無法再被報名。此動作無法在前端復原。")) {
                    onCloseSession(session.id);
                  }
                }}
                style={{ width: "100%", padding: "12px", borderRadius: 12, border: "1px solid rgba(200,90,90,0.35)", background: "rgba(200,90,90,0.12)", color: "#C85A5A", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={(e) => { e.target.style.background = "rgba(200,90,90,0.22)"; }}
                onMouseLeave={(e) => { e.target.style.background = "rgba(200,90,90,0.12)"; }}
              >🚫 關閉此場次（立刻隱藏）</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

/* ════════════════════════════════════════════
   Player (Buddy) Components
   ════════════════════════════════════════════ */
const POSITIONS = ["舉球", "舉對", "大砲", "快攻", "自由", "不限"];
const TIME_SLOTS = ["平日白天", "平日晚上", "週末白天", "週末晚上"];

const SKILL_DIMS = [
  { key: "serve", label: "發球", descs: ["低手發球為主，常掛網或出界", "穩定低手發球，嘗試上手但控制不佳", "上手發球穩定，能控制落點，偶爾飄球", "飄球穩定且有威脅，能針對弱點發球", "跳發或強飄具直接得分能力"] },
  { key: "receive", label: "接球", descs: ["常漏接或判斷不到位，需隊友大量補位", "能接一般發球，但方向不穩定", "面對上手發球能穩定回傳到舉球位置", "面對飄球也能穩定接起，一傳到位率高", "各種強發球都能精準送到舉球員手上"] },
  { key: "attack", label: "攻擊", descs: ["無法完成扣球，主要推球或拍球過網", "能基本扣球但時機不穩，常下網出界", "扣球有力道和成功率，能打直線斜線", "路線多變，能吊球輕扣，突破雙人攔網", "各位置都能攻擊，後排攻穩定，絕對得分力"] },
  { key: "set", label: "舉球", descs: ["方向不穩，常持球或雙擊", "能舉基本高球，但高度方向不夠穩", "穩定舉高球到四號位和二號位", "能舉快攻和平拉開，有基本戰術意識", "各種球路精準，具欺敵能力和即時調整"] },
  { key: "block", label: "攔網", descs: ["不太會跳攔網，時機對不上", "知道要攔但起跳常慢半拍", "能判斷攻擊位置及時起跳，製造壓迫", "讀懂舉球員意圖提前移位，雙人配合好", "覆蓋面積大，穩定攔死得分能力"] },
  { key: "fitness", label: "體能", descs: ["跑不太動，站定點等球，兩局就需休息", "能基本跑位但速度不快，後段體力下降", "移動和反應夠用，能穩定打完兩小時", "橫移前後都快，整場體能穩定不掉", "爆發力續航力都強，能連續飛撲救球"] },
];

const LEVEL_TAGS = ["歡樂", "中下", "中階", "中上", "高階"];

/* ── Radar Chart (SVG) ── */
const RadarChart = ({ skills, size = 120 }) => {
  if (!skills || Object.keys(skills).length === 0) return null;
  const dims = SKILL_DIMS;
  const cx = size / 2, cy = size / 2, maxR = size / 2 - 16;
  const angleStep = (Math.PI * 2) / dims.length;
  const getPoint = (i, val) => {
    const a = angleStep * i - Math.PI / 2;
    const r = (val / 5) * maxR;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };

  const gridLevels = [1, 2, 3, 4, 5];
  const dataPoints = dims.map((d, i) => getPoint(i, skills[d.key] || 0));
  const avg = dims.reduce((s, d) => s + (skills[d.key] || 0), 0) / dims.length;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      {/* Grid */}
      {gridLevels.map(lv => {
        const pts = dims.map((_, i) => getPoint(i, lv));
        return <polygon key={lv} points={pts.map(p => p.join(",")).join(" ")} fill="none" stroke="rgba(180,165,130,0.22)" strokeWidth="0.5"/>;
      })}
      {/* Axes */}
      {dims.map((_, i) => {
        const [x, y] = getPoint(i, 5);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(180,165,130,0.18)" strokeWidth="0.5"/>;
      })}
      {/* Data area */}
      <polygon points={dataPoints.map(p => p.join(",")).join(" ")} fill="rgba(196,167,136,0.28)" stroke="#C4A788" strokeWidth="1.5"/>
      {/* Data dots */}
      {dataPoints.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill="#C4A788"/>)}
      {/* Labels */}
      {dims.map((d, i) => {
        const [x, y] = getPoint(i, 6.2);
        return <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="central" fill="#5A7B9A" fontSize="10" fontFamily="'Noto Sans TC', sans-serif">{d.label}</text>;
      })}
      {/* Center avg */}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill="#C4A788" fontSize="13" fontWeight="700" fontFamily="'Space Mono', monospace">{avg.toFixed(1)}</text>
    </svg>
  );
};

/* ── PlayerCard — modified: added onShare prop + 📤 分享 button ── */
const PlayerCard = ({ player, onEdit, onWantToPlay, onRecord, currentUser, onShare }) => {
  const hasSkills = player.skills && Object.values(player.skills).some(v => v > 0);
  const isOwner = currentUser && player.uid === currentUser.uid;
  // Check if "want to play" is active
  const wantExpiry = player.wantToPlayUntil || 0;
  const isWanting = wantExpiry > Date.now();
  const remainHours = isWanting ? Math.ceil((wantExpiry - Date.now()) / 3600000) : 0;

  return (
  <div style={{ background: "var(--card-bg)", borderRadius: 16, padding: "18px 22px 18px 26px", border: "1px solid", borderColor: isWanting ? "rgba(127,168,124,0.4)" : "var(--border)", position: "relative", overflow: "hidden", transition: "all 0.25s ease" }}
    onMouseEnter={(e) => { e.currentTarget.style.borderColor = isWanting ? "rgba(127,168,124,0.6)" : "rgba(196,167,136,0.4)"; e.currentTarget.style.boxShadow = isWanting ? "0 8px 24px rgba(127,168,124,0.18)" : "0 8px 24px rgba(196,167,136,0.15)"; }}
    onMouseLeave={(e) => { e.currentTarget.style.borderColor = isWanting ? "rgba(127,168,124,0.4)" : "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
  >
    <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: isWanting ? "#7FA87C" : "#C4A788", opacity: 0.85 }}/>

    {/* Want to play badge */}
    {isWanting && (
      <div style={{ position: "absolute", top: 10, left: 26, display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 12, background: "rgba(127,168,124,0.22)", border: "1px solid rgba(127,168,124,0.32)", animation: "pulse 2s ease infinite" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#7FA87C", display: "inline-block" }}/>
        <span style={{ fontSize: 11, color: "#7FA87C", fontWeight: 700 }}>想打球！ 剩 {remainHours}h</span>
      </div>
    )}

    {/* Edit / want-to-play / record / share buttons top-right */}
    <div style={{ position: "absolute", top: 10, right: 12, display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
      {isOwner && !isWanting && (
        <button onClick={() => onWantToPlay(player)} title="我想打球"
          style={{ background: "rgba(127,168,124,0.15)", border: "1px solid rgba(127,168,124,0.28)", borderRadius: 8, padding: "5px 8px", cursor: "pointer", color: "#7FA87C", display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, transition: "all 0.2s" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(127,168,124,0.25)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(127,168,124,0.15)"; }}
        >🏐 想打球</button>
      )}
      {isOwner && (
        <button onClick={() => onRecord(player)} title="記錄本週戰績"
          style={{ background: "rgba(232,155,94,0.15)", border: "1px solid rgba(232,155,94,0.28)", borderRadius: 8, padding: "5px 8px", cursor: "pointer", color: "#E89B5E", display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, transition: "all 0.2s" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(232,155,94,0.25)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(232,155,94,0.15)"; }}
        >📊 記錄</button>
      )}
      {isOwner && (
        <button onClick={() => onShare(player)} title="下載戰績卡分享"
          style={{ background: "rgba(232,155,94,0.15)", border: "1px solid rgba(232,155,94,0.28)", borderRadius: 8, padding: "5px 8px", cursor: "pointer", color: "#E89B5E", display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, transition: "all 0.2s" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(232,155,94,0.25)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(232,155,94,0.15)"; }}
        >📤 分享</button>
      )}
      <button onClick={() => onEdit(player)} title="編輯"
        style={{ background: "rgba(180,165,130,0.12)", border: "1px solid rgba(180,165,130,0.18)", borderRadius: 8, padding: "5px 8px", cursor: "pointer", color: "#8A7F6A", display: "flex", alignItems: "center", gap: 4, fontSize: 11, transition: "all 0.2s" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(196,167,136,0.18)"; e.currentTarget.style.color = "#C4A788"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(180,165,130,0.12)"; e.currentTarget.style.color = "#8A7F6A"; }}
      ><EditIcon /> 編輯</button>
    </div>

    <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginTop: isWanting ? 28 : 32 }}>
      {hasSkills && (
        <div style={{ flexShrink: 0 }}>
          <RadarChart skills={player.skills} size={110}/>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, paddingRight: hasSkills ? 0 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          {/* Google avatar or default icon */}
          {player.photoURL ? (
            <img src={player.photoURL} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(196,167,136,0.3)" }}/>
          ) : !hasSkills && <span style={{ fontSize: 28 }}>🏐</span>}
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>{player.nickname}</div>
            <div style={{ fontSize: 11, color: "#C4A788", fontWeight: 600 }}>{player.level}・球齡 {player.experience}</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "6px 14px", fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>
          <span>📍 {player.area}</span>
          {player.position && <span>🧤 {player.position}</span>}
          {player.height && <span>📏 {player.height} cm</span>}
          {player.gender && <span>👤 {player.gender}</span>}
        </div>
        {player.timeSlots && player.timeSlots.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {player.timeSlots.map(t => (
              <span key={t} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 12, background: "rgba(90,143,168,0.18)", color: "#5A8FA8", fontWeight: 600 }}>{t}</span>
            ))}
          </div>
        )}
        {player.intro && <div style={{ fontSize: 12, color: "var(--text-dim)", fontStyle: "italic", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>💬 {player.intro}</div>}

        {/* Win rate stats */}
        {(() => {
          const stats = calcWinStats(player.weeklyRecords);
          if (!stats) return null;
          const { totalPlayed, totalWon, rate, thisWeek, trend, recent } = stats;
          return (
            <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "rgba(232,155,94,0.08)", border: "1px solid rgba(232,155,94,0.25)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#E89B5E" }}>📊 勝率</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: "#E89B5E", fontFamily: "'Space Mono', monospace" }}>{rate}%</span>
                  <span style={{ fontSize: 11, color: "#8A7F6A" }}>({totalPlayed} 場)</span>
                  {trend === "up" && <span style={{ color: "#7FA87C", fontSize: 12, fontWeight: 700 }}>↑</span>}
                  {trend === "down" && <span style={{ color: "#C85A5A", fontSize: 12, fontWeight: 700 }}>↓</span>}
                </div>
                {thisWeek && (
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: "rgba(232,155,94,0.18)", color: "#E89B5E", fontWeight: 600 }}>
                    本週 {thisWeek.won}W {thisWeek.played - thisWeek.won}L
                  </span>
                )}
              </div>
              {/* Mini trend chart — last 8 weeks */}
              {recent.length > 1 && (
                <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 28 }}>
                  {recent.slice().reverse().map((r, i) => {
                    const wr = r.played > 0 ? r.won / r.played : 0;
                    const h = Math.max(4, wr * 24);
                    return <div key={i} style={{ flex: 1, height: h, borderRadius: 2, background: wr >= 0.5 ? "rgba(127,168,124,0.5)" : "rgba(200,90,90,0.4)", transition: "height 0.3s" }} title={`${r.week}: ${r.won}/${r.played}`}/>;
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  </div>
  );
};

/* ════════════════════════════════════════════
   Share Card Modal — Canvas-based PNG generator
   ════════════════════════════════════════════ */
// Helper: draw rounded rectangle path
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Helper: draw radar chart
function drawRadar(ctx, skills, cx, cy, radius) {
  const dims = SKILL_DIMS;
  const angleStep = (Math.PI * 2) / dims.length;

  // Grid polygons (5 levels)
  ctx.strokeStyle = "#1E3A5F";
  ctx.lineWidth = 1.5;
  for (let lv = 1; lv <= 5; lv++) {
    const r = (lv / 5) * radius;
    ctx.beginPath();
    for (let i = 0; i < dims.length; i++) {
      const a = angleStep * i - Math.PI / 2;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = "#3A5A7A";
  ctx.lineWidth = 1;
  for (let i = 0; i < dims.length; i++) {
    const a = angleStep * i - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
    ctx.stroke();
  }

  // Data polygon
  ctx.beginPath();
  for (let i = 0; i < dims.length; i++) {
    const val = skills[dims[i].key] || 0;
    const r = (val / 5) * radius;
    const a = angleStep * i - Math.PI / 2;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(232,155,94,0.3)";
  ctx.fill();
  ctx.strokeStyle = "#E89B5E";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Data dots
  ctx.fillStyle = "#E89B5E";
  for (let i = 0; i < dims.length; i++) {
    const val = skills[dims[i].key] || 0;
    const r = (val / 5) * radius;
    const a = angleStep * i - Math.PI / 2;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Labels
  ctx.fillStyle = "#334155";
  ctx.font = `800 18px "PingFang TC", "Microsoft JhengHei", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < dims.length; i++) {
    const a = angleStep * i - Math.PI / 2;
    const labelR = radius + 26;
    const x = cx + labelR * Math.cos(a);
    const y = cy + labelR * Math.sin(a);
    ctx.fillText(dims[i].label, x, y);
  }

  // Center avg
  const avg = dims.reduce((s, d) => s + (skills[d.key] || 0), 0) / dims.length;
  ctx.fillStyle = "#B56620";
  ctx.font = `900 28px "Space Mono", "Menlo", monospace`;
  ctx.fillText(avg.toFixed(1), cx, cy);
}

// Helper: draw 8-week trend bars
function drawTrendBars(ctx, records, x, y, w, h) {
  const recs = records.slice().reverse();
  const n = recs.length;
  const gap = 4;
  const barW = (w - gap * (n - 1)) / n;

  for (let i = 0; i < n; i++) {
    const r = recs[i];
    const wr = r.played > 0 ? r.won / r.played : 0;
    const barH = Math.max(6, wr * h);
    const bx = x + i * (barW + gap);
    const by = y + h - barH;

    ctx.fillStyle = wr >= 0.5 ? "#9FBB9D" : "#E89C9C";
    roundRect(ctx, bx, by, barW, barH, 3);
    ctx.fill();
  }
}

const ShareCardModal = ({ open, onClose, player }) => {
  const [size, setSize] = useState("vertical"); // "vertical" or "square"
  const [generating, setGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (open && player) {
      setPreviewUrl(null);
      setGenerating(true);
      // Delay slightly so modal renders first
      const timer = setTimeout(() => {
        generateImage();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [open, player, size]);

  const generateImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const isVertical = size === "vertical";
    const W = 1080;
    const H = isVertical ? 1920 : 1080;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // White background
    ctx.fillStyle = "#FFF9EC";
    ctx.fillRect(0, 0, W, H);

    // Top orange accent strip
    const stripH = isVertical ? 24 : 20;
    const gradient = ctx.createLinearGradient(0, 0, W, 0);
    gradient.addColorStop(0, "#E89B5E");
    gradient.addColorStop(1, "#D4855F");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, stripH);

    const pad = isVertical ? 72 : 56;
    let cursorY = stripH + (isVertical ? 80 : 56);

    // Avatar circle + name
    const avatarSize = isVertical ? 130 : 110;
    const avatarX = pad + avatarSize / 2;
    const avatarY = cursorY + avatarSize / 2;

    ctx.fillStyle = "#e0e7ff";
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarSize / 2, 0, Math.PI * 2);
    ctx.fill();

    const initial = (player.nickname || "?").charAt(0);
    ctx.fillStyle = "#4f46e5";
    ctx.font = `900 ${avatarSize * 0.45}px "PingFang TC", "Microsoft JhengHei", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initial, avatarX, avatarY + 4);

    const nameX = avatarX + avatarSize / 2 + 28;
    ctx.fillStyle = "#FFF9EC";
    ctx.font = `900 ${isVertical ? 64 : 54}px "PingFang TC", "Microsoft JhengHei", sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(player.nickname || "—", nameX, cursorY + 10);

    ctx.fillStyle = "#8A7F6A";
    ctx.font = `600 ${isVertical ? 28 : 24}px "PingFang TC", "Microsoft JhengHei", sans-serif`;
    const metaParts = [];
    if (player.area) metaParts.push(`📍 ${player.area}`);
    if (player.experience) metaParts.push(`球齡 ${player.experience}`);
    if (player.level) metaParts.push(player.level);
    ctx.fillText(metaParts.join(" · "), nameX, cursorY + (isVertical ? 82 : 70));

    cursorY += avatarSize + (isVertical ? 60 : 40);

    // Win rate hero card
    const stats = calcWinStats(player.weeklyRecords);
    if (stats) {
      const heroH = isVertical ? 280 : 200;
      const heroW = W - pad * 2;

      const heroGradient = ctx.createLinearGradient(0, cursorY, 0, cursorY + heroH);
      heroGradient.addColorStop(0, "#fff7ed");
      heroGradient.addColorStop(1, "#fef3c7");
      ctx.fillStyle = heroGradient;
      roundRect(ctx, pad, cursorY, heroW, heroH, 24);
      ctx.fill();

      ctx.strokeStyle = "#fde68a";
      ctx.lineWidth = 2;
      roundRect(ctx, pad, cursorY, heroW, heroH, 24);
      ctx.stroke();

      ctx.fillStyle = "#92400e";
      ctx.font = `800 ${isVertical ? 22 : 18}px "PingFang TC", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("OVERALL WIN RATE", W / 2, cursorY + (isVertical ? 34 : 24));

      ctx.fillStyle = "#B56620";
      const numSize = isVertical ? 180 : 130;
      ctx.font = `900 ${numSize}px "Space Mono", "Menlo", monospace`;
      ctx.textBaseline = "middle";
      const rateText = `${stats.rate}`;
      const rateMetrics = ctx.measureText(rateText);
      const pctSize = numSize * 0.5;

      const rateY = cursorY + heroH / 2 + (isVertical ? 20 : 10);
      ctx.fillText(rateText, W / 2 - 20, rateY);

      ctx.font = `900 ${pctSize}px "Space Mono", "Menlo", monospace`;
      ctx.textAlign = "left";
      ctx.fillText("%", W / 2 + rateMetrics.width / 2 - 15, rateY + (isVertical ? 15 : 10));

      ctx.fillStyle = "#78350f";
      ctx.font = `700 ${isVertical ? 26 : 20}px "PingFang TC", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${stats.totalWon} 勝 / ${stats.totalPlayed} 場`, W / 2, cursorY + heroH - (isVertical ? 28 : 20));

      cursorY += heroH + (isVertical ? 40 : 28);
    } else {
      const heroH = isVertical ? 180 : 120;
      ctx.fillStyle = "#f8fafc";
      roundRect(ctx, pad, cursorY, W - pad * 2, heroH, 24);
      ctx.fill();
      ctx.fillStyle = "#5A7B9A";
      ctx.font = `700 ${isVertical ? 28 : 22}px "PingFang TC", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("尚未記錄戰績", W / 2, cursorY + heroH / 2);
      cursorY += heroH + (isVertical ? 40 : 28);
    }

    // Radar chart
    const hasSkills = player.skills && Object.values(player.skills).some(v => v > 0);
    if (hasSkills) {
      const radarH = isVertical ? 520 : 380;
      const radarW = isVertical ? W - pad * 2 : (W - pad * 2) * 0.55;

      ctx.fillStyle = "#f8fafc";
      roundRect(ctx, pad, cursorY, radarW, radarH, 24);
      ctx.fill();

      ctx.fillStyle = "#8A7F6A";
      ctx.font = `800 ${isVertical ? 22 : 18}px "PingFang TC", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("SKILL PROFILE", pad + radarW / 2, cursorY + (isVertical ? 30 : 24));

      drawRadar(ctx, player.skills, pad + radarW / 2, cursorY + radarH / 2 + (isVertical ? 10 : 0), isVertical ? 160 : 120);

      if (!isVertical) {
        const rightX = pad + radarW + 24;
        const rightW = W - rightX - pad;

        const recH = 170;
        ctx.fillStyle = "#fef3c7";
        roundRect(ctx, rightX, cursorY, rightW, recH, 24);
        ctx.fill();

        ctx.fillStyle = "#92400e";
        ctx.font = `800 18px "PingFang TC", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText("RECOMMENDED", rightX + rightW / 2, cursorY + 24);

        ctx.fillStyle = "#B56620";
        ctx.font = `900 86px "Space Mono", "Menlo", monospace`;
        ctx.textBaseline = "middle";
        const recCount = player.recommendCount || 0;
        ctx.fillText(`👍 ${recCount}`, rightX + rightW / 2, cursorY + 100);

        const trendY = cursorY + recH + 20;
        const trendH = radarH - recH - 20;
        ctx.fillStyle = "#f1f5f9";
        roundRect(ctx, rightX, trendY, rightW, trendH, 24);
        ctx.fill();

        ctx.fillStyle = "#8A7F6A";
        ctx.font = `800 16px "PingFang TC", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText("8 WEEK TREND", rightX + rightW / 2, trendY + 20);

        if (stats && stats.recent.length > 1) {
          drawTrendBars(ctx, stats.recent, rightX + 30, trendY + 60, rightW - 60, trendH - 90);
        } else {
          ctx.fillStyle = "#3A5A7A";
          ctx.font = `600 16px "PingFang TC", sans-serif`;
          ctx.fillText("資料不足", rightX + rightW / 2, trendY + trendH / 2);
        }
      }

      cursorY += radarH + (isVertical ? 40 : 30);
    }

    // Vertical: trend + recommendations side by side at bottom
    if (isVertical) {
      const boxH = 220;
      const gap = 24;
      const halfW = (W - pad * 2 - gap) / 2;

      ctx.fillStyle = "#f1f5f9";
      roundRect(ctx, pad, cursorY, halfW, boxH, 24);
      ctx.fill();

      ctx.fillStyle = "#8A7F6A";
      ctx.font = `800 22px "PingFang TC", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("8 WEEK TREND", pad + halfW / 2, cursorY + 24);

      if (stats && stats.recent.length > 1) {
        drawTrendBars(ctx, stats.recent, pad + 40, cursorY + 80, halfW - 80, boxH - 120);
      } else {
        ctx.fillStyle = "#3A5A7A";
        ctx.font = `600 20px "PingFang TC", sans-serif`;
        ctx.textBaseline = "middle";
        ctx.fillText("資料不足", pad + halfW / 2, cursorY + boxH / 2 + 20);
      }

      const recX = pad + halfW + gap;
      ctx.fillStyle = "#fef3c7";
      roundRect(ctx, recX, cursorY, halfW, boxH, 24);
      ctx.fill();

      ctx.fillStyle = "#92400e";
      ctx.font = `800 22px "PingFang TC", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("RECOMMENDED", recX + halfW / 2, cursorY + 24);

      ctx.fillStyle = "#B56620";
      ctx.font = `900 110px "Space Mono", "Menlo", monospace`;
      ctx.textBaseline = "middle";
      const recCount = player.recommendCount || 0;
      ctx.fillText(`👍 ${recCount}`, recX + halfW / 2, cursorY + boxH / 2 + 20);

      cursorY += boxH + 40;
    }

    // Bottom footer (dark bar)
    const footerH = isVertical ? 110 : 90;
    ctx.fillStyle = "#FFF9EC";
    ctx.fillRect(0, H - footerH, W, footerH);

    ctx.fillStyle = "#5A7B9A";
    ctx.font = `700 ${isVertical ? 20 : 16}px "PingFang TC", sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("POWERED BY", pad, H - footerH + (isVertical ? 28 : 22));

    ctx.fillStyle = "#E89B5E";
    ctx.font = `900 ${isVertical ? 34 : 28}px "PingFang TC", sans-serif`;
    ctx.fillText("排球揪團雷達", pad, H - footerH + (isVertical ? 56 : 46));

    ctx.fillStyle = "#3A5A7A";
    ctx.font = `600 ${isVertical ? 22 : 18}px "PingFang TC", sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText("radar-volleyball.vercel.app", W - pad, H - footerH / 2);

    try {
      const dataUrl = canvas.toDataURL("image/png");
      setPreviewUrl(dataUrl);
    } catch (err) {
      console.error("Canvas export failed:", err);
    }
    setGenerating(false);
  };

  const handleDownload = () => {
    if (!previewUrl) return;
    const link = document.createElement("a");
    link.href = previewUrl;
    link.download = `volleyball-card-${player.nickname || "player"}-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!open || !player) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(30,58,95,0.30)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 901, width: "min(480px, 94vw)", maxHeight: "92vh", overflowY: "auto", background: "linear-gradient(180deg, #FFF9EC, #FFF9EC)", borderRadius: 20, border: "1px solid rgba(232,155,94,0.3)", padding: "28px 24px", animation: "fadeIn 0.25s ease", boxShadow: "0 20px 60px rgba(30,58,95,0.20)" }}>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 24 }}>📤</span>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1E3A5F" }}>分享我的戰績卡</h3>
        </div>
        <p style={{ fontSize: 12, color: "#5A7B9A", marginBottom: 16, lineHeight: 1.5 }}>
          下載後可分享到 IG、LINE、FB 社團，讓更多朋友看到你的排球戰績。
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button onClick={() => setSize("vertical")}
            style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid", borderColor: size === "vertical" ? "#E89B5E" : "rgba(180,165,130,0.28)", background: size === "vertical" ? "rgba(232,155,94,0.18)" : "transparent", color: size === "vertical" ? "#E89B5E" : "#5A7B9A", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}>
            📱 直式<br/><span style={{ fontSize: 10, opacity: 0.7 }}>IG 限動 / LINE 相簿</span>
          </button>
          <button onClick={() => setSize("square")}
            style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid", borderColor: size === "square" ? "#E89B5E" : "rgba(180,165,130,0.28)", background: size === "square" ? "rgba(232,155,94,0.18)" : "transparent", color: size === "square" ? "#E89B5E" : "#5A7B9A", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}>
            🟦 正方形<br/><span style={{ fontSize: 10, opacity: 0.7 }}>IG 貼文 / FB</span>
          </button>
        </div>

        <div style={{ marginBottom: 16, padding: 16, background: "rgba(255,249,236,0.7)", borderRadius: 12, display: "flex", justifyContent: "center", alignItems: "center", minHeight: 300 }}>
          {generating && (
            <div style={{ textAlign: "center", color: "#5A7B9A", fontSize: 13 }}>
              <div style={{ fontSize: 32, marginBottom: 8, animation: "spin 1.5s linear infinite", display: "inline-block" }}>🎨</div>
              <div>繪製中...</div>
            </div>
          )}
          {!generating && previewUrl && (
            <img src={previewUrl} alt="preview" style={{ maxWidth: "100%", maxHeight: 380, borderRadius: 8, boxShadow: "0 4px 20px rgba(30,58,95,0.15)" }}/>
          )}
          <canvas ref={canvasRef} style={{ display: "none" }}/>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: "14px", borderRadius: 12, border: "1px solid rgba(180,165,130,0.28)", background: "transparent", color: "#5A7B9A", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            關閉
          </button>
          <button onClick={handleDownload} disabled={!previewUrl || generating}
            style={{ flex: 2, padding: "14px", borderRadius: 12, border: "none", background: (!previewUrl || generating) ? "rgba(180,165,130,0.22)" : "linear-gradient(135deg, #E89B5E, #D4855F)", color: (!previewUrl || generating) ? "#8A7F6A" : "#fff", fontSize: 14, fontWeight: 700, cursor: (!previewUrl || generating) ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            💾 下載 PNG
          </button>
        </div>

        <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: "rgba(232,155,94,0.12)", border: "1px solid rgba(232,155,94,0.25)", fontSize: 11, color: "#E89B5E", lineHeight: 1.5 }}>
          💡 下載後可直接上傳到 IG 限動、LINE 相簿或 FB，邀請朋友一起來排球揪團雷達！
        </div>
      </div>
    </>
  );
};

/* ════════════════════════════════════════════
   Login Choice Modal — shown before player registration
   ════════════════════════════════════════════ */
const LoginChoiceModal = ({ open, onClose, onGoogle, onGuest, googleLoading }) => {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(30,58,95,0.30)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 901, width: "min(420px, 92vw)", background: "linear-gradient(180deg, #FFF9EC, #FFF9EC)", borderRadius: 20, border: "1px solid rgba(196,167,136,0.32)", padding: "32px 24px 24px", animation: "fadeIn 0.25s ease", boxShadow: "0 20px 60px rgba(30,58,95,0.20)" }}>

        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🏐</div>
          <h3 style={{ fontSize: 20, fontWeight: 800, color: "#1E3A5F", marginBottom: 6 }}>歡迎加入排球夥伴</h3>
          <p style={{ fontSize: 13, color: "#5A7B9A", lineHeight: 1.6 }}>
            選擇你的註冊方式<br/>
            <span style={{ fontSize: 11, color: "#8A7F6A" }}>Google 登入可以讓你隨時管理自己的資料</span>
          </p>
        </div>

        {/* Google 登入（推薦選項）*/}
        <div style={{ position: "relative", marginBottom: 12 }}>
          <div style={{ position: "absolute", top: -10, right: 16, fontSize: 10, padding: "3px 10px", borderRadius: 12, background: "linear-gradient(135deg, #C4A788, #A88B6B)", color: "#fff", fontWeight: 700, letterSpacing: "0.05em", boxShadow: "0 2px 8px rgba(196,167,136,0.4)", zIndex: 1 }}>
            ⭐ 推薦
          </div>
          <button onClick={onGoogle} disabled={googleLoading}
            style={{ width: "100%", padding: "16px 20px", borderRadius: 14, border: "2px solid rgba(196,167,136,0.4)", background: googleLoading ? "rgba(196,167,136,0.15)" : "linear-gradient(135deg, rgba(196,167,136,0.22), rgba(139,92,246,0.15))", color: "#fff", fontSize: 15, fontWeight: 700, cursor: googleLoading ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, transition: "all 0.2s" }}
            onMouseEnter={(e) => { if (!googleLoading) { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(196,167,136,0.3)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
          >
            {googleLoading ? (
              <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⏳</span> 登入中...</>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
                用 Google 註冊
              </>
            )}
          </button>
          <div style={{ fontSize: 11, color: "#C4A788", marginTop: 6, textAlign: "center", fontWeight: 600 }}>
            ✓ 免設密碼　✓ 自動帶入資料　✓ 可以管理自己的資料
          </div>
        </div>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0" }}>
          <div style={{ flex: 1, height: 1, background: "rgba(180,165,130,0.22)" }}/>
          <span style={{ fontSize: 11, color: "#8A7F6A", fontWeight: 600 }}>或</span>
          <div style={{ flex: 1, height: 1, background: "rgba(180,165,130,0.22)" }}/>
        </div>

        {/* 訪客登入 */}
        <button onClick={onGuest}
          style={{ width: "100%", padding: "12px 20px", borderRadius: 14, border: "1px solid rgba(180,165,130,0.28)", background: "transparent", color: "#5A7B9A", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "all 0.2s" }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(180,165,130,0.4)"; e.currentTarget.style.color = "#3A5A7A"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(180,165,130,0.28)"; e.currentTarget.style.color = "#5A7B9A"; }}
        >
          👤 訪客註冊（用密碼保護資料）
        </button>
        <div style={{ fontSize: 11, color: "#8A7F6A", marginTop: 6, textAlign: "center" }}>
          不想綁 Google？可以用密碼保護你的資料
        </div>

      </div>
    </>
  );
};

/* ════════════════════════════════════════════
   Member Center Modal — Full member dashboard
   ════════════════════════════════════════════ */
const MemberCenterModal = ({ open, onClose, currentUser, players, onEditProfile, onOpenRegisterFlow, onWantToPlay, onRecord, onShare, onDelete, onMergeDuplicates, onEditRecord }) => {
  if (!open || !currentUser) return null;

  // Find ALL players matching this user's uid (to detect duplicates)
  const myPlayers = players.filter(p => p.uid === currentUser.uid);
  const myPlayer = myPlayers.length > 0 ? myPlayers.sort((a, b) => {
    const aTime = a.createdAt?.seconds || a.createdAt?.toMillis?.() || 0;
    const bTime = b.createdAt?.seconds || b.createdAt?.toMillis?.() || 0;
    return bTime - aTime; // newest first
  })[0] : null;
  const hasDuplicates = myPlayers.length > 1;

  // Empty state — no player data yet
  if (!myPlayer) {
    return (
      <>
        <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(30,58,95,0.30)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
        <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 901, width: "min(420px, 92vw)", background: "linear-gradient(180deg, #FFF9EC, #FFF9EC)", borderRadius: 20, border: "1px solid rgba(196,167,136,0.32)", padding: "36px 24px 28px", animation: "fadeIn 0.25s ease", boxShadow: "0 20px 60px rgba(30,58,95,0.20)", textAlign: "center" }}>
          <div style={{ fontSize: 56, marginBottom: 12, opacity: 0.8 }}>🏐</div>
          <h3 style={{ fontSize: 20, fontWeight: 800, color: "#1E3A5F", marginBottom: 8 }}>歡迎加入排球夥伴</h3>
          <p style={{ fontSize: 13, color: "#5A7B9A", marginBottom: 24, lineHeight: 1.6 }}>
            你還沒有球員資料，建立後就能在這裡管理自己的<br/>
            戰績、推薦、想打球狀態等所有會員功能
          </p>
          <button onClick={() => { onClose(); onOpenRegisterFlow(); }}
            style={{ width: "100%", padding: "14px", borderRadius: 14, border: "none", background: "linear-gradient(135deg, #C4A788, #A88B6B)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", marginBottom: 10, transition: "all 0.2s" }}
            onMouseEnter={(e) => { e.target.style.transform = "scale(1.02)"; }}
            onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; }}
          >🙋 立即建立球員資料</button>
          <button onClick={onClose}
            style={{ width: "100%", padding: "12px", borderRadius: 12, border: "1px solid rgba(180,165,130,0.28)", background: "transparent", color: "#5A7B9A", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >稍後再說</button>
        </div>
      </>
    );
  }

  // Main member center
  const stats = calcWinStats(myPlayer.weeklyRecords);
  const wantExpiry = myPlayer.wantToPlayUntil || 0;
  const isWanting = wantExpiry > Date.now();
  const remainHours = isWanting ? Math.ceil((wantExpiry - Date.now()) / 3600000) : 0;
  const recommendations = myPlayer.recommendations || [];
  const recommendCount = myPlayer.recommendCount || recommendations.length;
  const sortedRecords = (myPlayer.weeklyRecords || []).slice().sort((a, b) => b.week.localeCompare(a.week));

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(30,58,95,0.30)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, top: 0, zIndex: 901, overflowY: "auto", background: "linear-gradient(180deg, #F8F2E5 0%, #FFF9EC 40%, #F8F2E5 100%)", animation: "fadeIn 0.3s ease" }}>

        {/* Sticky top bar */}
        <div style={{ position: "sticky", top: 0, zIndex: 10, background: "linear-gradient(180deg, rgba(255,249,236,0.98) 0%, rgba(248,242,229,0.9) 100%)", borderBottom: "1px solid rgba(180,165,130,0.15)", padding: "14px 20px", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>👤</span>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#1E3A5F" }}>我的會員專區</h2>
          </div>
          <button onClick={onClose}
            style={{ background: "rgba(180,165,130,0.15)", border: "1px solid rgba(180,165,130,0.22)", borderRadius: 10, padding: 8, cursor: "pointer", color: "#5A7B9A", display: "flex", transition: "all 0.2s" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(180,165,130,0.28)"; e.currentTarget.style.color = "#1E3A5F"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(180,165,130,0.15)"; e.currentTarget.style.color = "#5A7B9A"; }}
          ><CloseIcon/></button>
        </div>

        <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 20px 80px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* ⚠️ Duplicate alert */}
          {hasDuplicates && (
            <div style={{ padding: "14px 18px", borderRadius: 14, background: "rgba(232,155,94,0.15)", border: "1px solid rgba(232,155,94,0.3)", animation: "slideUp 0.4s ease" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 18 }}>⚠️</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: "#E89B5E" }}>偵測到 {myPlayers.length} 筆重複資料</span>
              </div>
              <p style={{ fontSize: 12, color: "#5A7B9A", marginBottom: 12, lineHeight: 1.6 }}>
                你的帳號有多筆球員資料，可能是之前誤觸建立的。<br/>
                合併後會保留最新的資料 + 加總戰績與推薦，舊的會被安全刪除。
              </p>
              <button onClick={() => onMergeDuplicates(myPlayers)}
                style={{ padding: "8px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #E89B5E, #D4855F)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={(e) => { e.target.style.transform = "scale(1.04)"; }}
                onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; }}
              >🔀 合併這 {myPlayers.length} 筆資料</button>
            </div>
          )}

          {/* ─── 個人資料卡 ─── */}
          <div style={{ padding: "20px 22px", borderRadius: 16, background: "rgba(196,167,136,0.12)", border: "1px solid rgba(196,167,136,0.28)", position: "relative", overflow: "hidden", animation: "slideUp 0.4s ease 0.05s both" }}>
            <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: "#C4A788", opacity: 0.85 }}/>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 14 }}>
              {myPlayer.photoURL ? (
                <img src={myPlayer.photoURL} alt="" style={{ width: 60, height: 60, borderRadius: "50%", border: "3px solid rgba(196,167,136,0.4)", objectFit: "cover", flexShrink: 0 }}/>
              ) : (
                <div style={{ width: 60, height: 60, borderRadius: "50%", background: "rgba(196,167,136,0.28)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>🏐</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#1E3A5F", marginBottom: 4 }}>{myPlayer.nickname}</div>
                <div style={{ fontSize: 12, color: "#C4A788", fontWeight: 600, marginBottom: 6 }}>{myPlayer.level}・球齡 {myPlayer.experience}</div>
                <div style={{ fontSize: 11, color: "#8A7F6A", display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <span>📍 {myPlayer.area}</span>
                  {myPlayer.position && <span>🧤 {myPlayer.position}</span>}
                  {myPlayer.height && <span>📏 {myPlayer.height} cm</span>}
                </div>
              </div>
            </div>
            <button onClick={() => onEditProfile(myPlayer)}
              style={{ width: "100%", padding: "10px", borderRadius: 10, border: "1px solid rgba(196,167,136,0.3)", background: "rgba(196,167,136,0.15)", color: "#C4A788", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.2s" }}
              onMouseEnter={(e) => { e.target.style.background = "rgba(196,167,136,0.22)"; }}
              onMouseLeave={(e) => { e.target.style.background = "rgba(196,167,136,0.15)"; }}
            ><EditIcon/> 編輯我的資料</button>
          </div>

          {/* ─── 想打球開關 ─── */}
          <div style={{ padding: "16px 20px", borderRadius: 16, background: isWanting ? "rgba(127,168,124,0.15)" : "rgba(248,242,229,0.5)", border: "1px solid", borderColor: isWanting ? "rgba(127,168,124,0.35)" : "rgba(180,165,130,0.15)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, animation: "slideUp 0.4s ease 0.1s both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>{isWanting ? "🟢" : "⚪"}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: isWanting ? "#7FA87C" : "#1E3A5F" }}>
                  {isWanting ? `想打球！剩 ${remainHours} 小時` : "想打球狀態"}
                </div>
                <div style={{ fontSize: 11, color: "#8A7F6A", marginTop: 2 }}>
                  {isWanting ? "其他球員可以看到你想打球" : "開啟後 6 小時內告訴大家你想打球"}
                </div>
              </div>
            </div>
            <button onClick={() => onWantToPlay(myPlayer)}
              disabled={isWanting}
              style={{ padding: "8px 18px", borderRadius: 10, border: "none", background: isWanting ? "rgba(180,165,130,0.22)" : "linear-gradient(135deg, #7FA87C, #5B7A59)", color: isWanting ? "#8A7F6A" : "#fff", fontSize: 12, fontWeight: 700, cursor: isWanting ? "not-allowed" : "pointer", transition: "all 0.2s" }}
              onMouseEnter={(e) => { if (!isWanting) e.target.style.transform = "scale(1.04)"; }}
              onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; }}
            >{isWanting ? "已開啟" : "🏐 我想打球"}</button>
          </div>

          {/* ─── 本週戰績 ─── */}
          <div style={{ padding: "18px 22px", borderRadius: 16, background: "rgba(232,155,94,0.10)", border: "1px solid rgba(232,155,94,0.28)", animation: "slideUp 0.4s ease 0.15s both" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 20 }}>📊</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#E89B5E" }}>本週戰績</div>
                  <div style={{ fontSize: 11, color: "#8A7F6A", fontFamily: "'Space Mono', monospace" }}>{getCurrentWeek()}</div>
                </div>
              </div>
              <button onClick={() => onRecord(myPlayer)}
                style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #E89B5E, #D4855F)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={(e) => { e.target.style.transform = "scale(1.04)"; }}
                onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; }}
              >📝 記錄本週</button>
            </div>
            {(() => {
              const week = getCurrentWeek();
              const thisWeek = (myPlayer.weeklyRecords || []).find(r => r.week === week);
              if (!thisWeek) {
                return <div style={{ fontSize: 12, color: "#8A7F6A", fontStyle: "italic" }}>本週尚未記錄戰績</div>;
              }
              const wr = thisWeek.played > 0 ? Math.round((thisWeek.won / thisWeek.played) * 100) : 0;
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ fontSize: 28, fontWeight: 800, color: "#E89B5E", fontFamily: "'Space Mono', monospace" }}>{wr}%</span>
                  <span style={{ fontSize: 13, color: "#1E3A5F", fontWeight: 600 }}>{thisWeek.won}W {thisWeek.played - thisWeek.won}L</span>
                  <span style={{ fontSize: 11, color: "#8A7F6A", marginLeft: "auto" }}>{thisWeek.played} 場</span>
                </div>
              );
            })()}
          </div>

          {/* ─── 總戰績總覽 + 分享 ─── */}
          {stats ? (
            <div style={{ padding: "20px 22px", borderRadius: 16, background: "linear-gradient(135deg, rgba(232,155,94,0.15), rgba(249,115,22,0.08))", border: "1px solid rgba(232,155,94,0.3)", animation: "slideUp 0.4s ease 0.2s both" }}>
              <div style={{ fontSize: 11, color: "#E89B5E", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 6 }}>OVERALL</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
                <span style={{ fontSize: 48, fontWeight: 900, color: "#E89B5E", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{stats.rate}</span>
                <span style={{ fontSize: 24, fontWeight: 800, color: "#E89B5E" }}>%</span>
                <span style={{ fontSize: 13, color: "#5A7B9A", marginLeft: "auto" }}>{stats.totalWon}W / {stats.totalPlayed} 場</span>
              </div>
              {stats.recent && stats.recent.length > 1 && (
                <>
                  <div style={{ fontSize: 11, color: "#8A7F6A", marginBottom: 6 }}>📈 近 {stats.recent.length} 週趨勢</div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 48, marginBottom: 14 }}>
                    {stats.recent.slice().reverse().map((r, i) => {
                      const wr = r.played > 0 ? r.won / r.played : 0;
                      const h = Math.max(6, wr * 42);
                      return <div key={i} style={{ flex: 1, height: h, borderRadius: 3, background: wr >= 0.5 ? "rgba(127,168,124,0.6)" : "rgba(200,90,90,0.5)", transition: "height 0.3s" }} title={`${r.week}: ${r.won}/${r.played}`}/>;
                    })}
                  </div>
                </>
              )}
              <button onClick={() => onShare(myPlayer)}
                style={{ width: "100%", padding: "11px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #E89B5E, #D4855F)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.2s" }}
                onMouseEnter={(e) => { e.target.style.transform = "scale(1.02)"; e.target.style.boxShadow = "0 4px 20px rgba(232,155,94,0.3)"; }}
                onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; e.target.style.boxShadow = "none"; }}
              >📤 分享我的戰績卡</button>
            </div>
          ) : (
            <div style={{ padding: "24px", borderRadius: 16, background: "rgba(248,242,229,0.5)", border: "1px dashed rgba(180,165,130,0.28)", textAlign: "center", animation: "slideUp 0.4s ease 0.2s both" }}>
              <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.6 }}>📊</div>
              <div style={{ fontSize: 13, color: "#5A7B9A", marginBottom: 6 }}>還沒有戰績紀錄</div>
              <div style={{ fontSize: 11, color: "#8A7F6A" }}>記錄本週戰績後，這裡會顯示你的總勝率與趨勢圖</div>
            </div>
          )}

          {/* ─── 歷史戰績清單 ─── */}
          {sortedRecords.length > 0 && (
            <div style={{ padding: "18px 22px", borderRadius: 16, background: "rgba(248,242,229,0.5)", border: "1px solid rgba(180,165,130,0.15)", animation: "slideUp 0.4s ease 0.25s both" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 18 }}>📜</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: "#1E3A5F" }}>歷史戰績</span>
                <span style={{ fontSize: 11, color: "#8A7F6A" }}>（共 {sortedRecords.length} 週）</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
                {sortedRecords.map((r, i) => {
                  const wr = r.played > 0 ? Math.round((r.won / r.played) * 100) : 0;
                  const isCurrentWeek = r.week === getCurrentWeek();
                  return (
                    <div key={r.week}
                      style={{ padding: "10px 14px", borderRadius: 10, background: isCurrentWeek ? "rgba(232,155,94,0.15)" : "rgba(255,249,236,0.7)", border: "1px solid", borderColor: isCurrentWeek ? "rgba(232,155,94,0.3)" : "rgba(180,165,130,0.12)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 12, color: isCurrentWeek ? "#E89B5E" : "#5A7B9A", fontFamily: "'Space Mono', monospace", fontWeight: 600, minWidth: 80 }}>{r.week}</span>
                        <span style={{ fontSize: 13, color: "#1E3A5F", fontWeight: 600 }}>{r.won}W {r.played - r.won}L</span>
                        <span style={{ fontSize: 13, color: wr >= 50 ? "#7FA87C" : "#C85A5A", fontWeight: 800, fontFamily: "'Space Mono', monospace", marginLeft: "auto" }}>{wr}%</span>
                      </div>
                      <button onClick={() => onEditRecord(myPlayer, r)}
                        style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(180,165,130,0.22)", background: "transparent", color: "#5A7B9A", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#E89B5E"; e.currentTarget.style.color = "#E89B5E"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(180,165,130,0.22)"; e.currentTarget.style.color = "#5A7B9A"; }}
                      >修改</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─── 推薦我的人 ─── */}
          <div style={{ padding: "18px 22px", borderRadius: 16, background: "rgba(90,143,168,0.10)", border: "1px solid rgba(90,143,168,0.28)", animation: "slideUp 0.4s ease 0.3s both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 18 }}>👍</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: "#5A8FA8" }}>推薦我的人</span>
              {recommendCount > 0 && (
                <span style={{ fontSize: 12, padding: "2px 10px", borderRadius: 12, background: "rgba(90,143,168,0.25)", color: "#5A8FA8", fontWeight: 700 }}>{recommendCount} 人</span>
              )}
            </div>
            {recommendations.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: "#8A7F6A" }}>
                <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }}>💭</div>
                <div style={{ fontSize: 12 }}>還沒有人推薦你</div>
                <div style={{ fontSize: 11, marginTop: 4, opacity: 0.8 }}>認真打球、多交朋友，推薦會累積的 💪</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
                {recommendations.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map((rec, i) => (
                  <div key={i} style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(255,249,236,0.7)", border: "1px solid rgba(90,143,168,0.18)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: rec.message ? 4 : 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#5A8FA8", display: "flex", alignItems: "center", gap: 5 }}>
                        👤 {rec.fromName || "某位球員"}
                      </span>
                      <span style={{ fontSize: 10, color: "#8A7F6A" }}>{formatRelativeTime(rec.createdAt)}</span>
                    </div>
                    {rec.message && (
                      <div style={{ fontSize: 12, color: "#3A5A7A", lineHeight: 1.5, fontStyle: "italic", wordBreak: "break-word" }}>
                        「{rec.message}」
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ─── 危險區域 ─── */}
          <div style={{ marginTop: 14, paddingTop: 20, borderTop: "1px dashed rgba(200,90,90,0.28)", animation: "slideUp 0.4s ease 0.35s both" }}>
            <div style={{ fontSize: 11, color: "#8A7F6A", marginBottom: 8, letterSpacing: "0.04em", textAlign: "center" }}>危險區域</div>
            <button onClick={() => onDelete(myPlayer.id)}
              style={{ width: "100%", padding: "12px", borderRadius: 12, border: "1px solid rgba(200,90,90,0.35)", background: "rgba(200,90,90,0.12)", color: "#C85A5A", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
              onMouseEnter={(e) => { e.target.style.background = "rgba(200,90,90,0.22)"; }}
              onMouseLeave={(e) => { e.target.style.background = "rgba(200,90,90,0.12)"; }}
            >🗑️ 刪除我的球員資料</button>
          </div>

        </div>
      </div>
    </>
  );
};


/* ════════════════════════════════════════════
   Header Auth Indicator — top-right corner login button or user pill
   ════════════════════════════════════════════ */
const HeaderAuthIndicator = ({ currentUser, onLogin, onLogout, googleLoading, onOpenMemberCenter }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });

  // Recalculate dropdown position when opening
  useEffect(() => {
    if (menuOpen && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
  }, [menuOpen]);

  if (currentUser) {
    return (
      <>
        <button ref={btnRef} onClick={() => setMenuOpen(o => !o)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px 4px 4px", borderRadius: 20, border: "1px solid rgba(127,168,124,0.32)", background: "rgba(127,168,124,0.15)", cursor: "pointer", transition: "all 0.2s" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(127,168,124,0.25)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(127,168,124,0.15)"; }}
        >
          {currentUser.photoURL ? (
            <img src={currentUser.photoURL} alt="" style={{ width: 22, height: 22, borderRadius: "50%" }}/>
          ) : (
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#C4A788", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff" }}>
              {(currentUser.displayName || "?").charAt(0)}
            </span>
          )}
          <span style={{ fontSize: 11, color: "#7FA87C", fontWeight: 700 }}>已登入</span>
        </button>
        {menuOpen && (
          <>
            <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 900 }}/>
            <div style={{ position: "fixed", top: menuPos.top, right: menuPos.right, zIndex: 901, minWidth: 220, maxWidth: "calc(100vw - 24px)", background: "linear-gradient(180deg, #FFF9EC, #FFF9EC)", borderRadius: 12, border: "1px solid rgba(180,165,130,0.28)", padding: "10px", boxShadow: "0 10px 30px rgba(30,58,95,0.20)", animation: "fadeIn 0.15s ease" }}>
              <div style={{ padding: "8px 10px", borderBottom: "1px dashed rgba(180,165,130,0.22)", marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1E3A5F", marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentUser.displayName || "—"}</div>
                <div style={{ fontSize: 10, color: "#8A7F6A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentUser.email || ""}</div>
              </div>
              <button onClick={() => { setMenuOpen(false); onOpenMemberCenter(); }}
                style={{ width: "100%", padding: "10px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, rgba(196,167,136,0.22), rgba(139,92,246,0.15))", color: "#C4A788", fontSize: 12, fontWeight: 700, cursor: "pointer", textAlign: "left", transition: "background 0.15s", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "linear-gradient(135deg, rgba(196,167,136,0.32), rgba(139,92,246,0.25))"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "linear-gradient(135deg, rgba(196,167,136,0.22), rgba(139,92,246,0.15))"; }}
              >
                <span style={{ fontSize: 14 }}>👤</span> 我的會員專區
              </button>
              <button onClick={() => { setMenuOpen(false); onLogout(); }}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", color: "#C85A5A", fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "left", transition: "background 0.15s" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(200,90,90,0.15)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                ↩️ 登出
              </button>
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <button onClick={onLogin} disabled={googleLoading}
      style={{ padding: "6px 12px", borderRadius: 20, border: "1px solid rgba(196,167,136,0.3)", background: "rgba(196,167,136,0.15)", color: "#C4A788", fontSize: 11, fontWeight: 700, cursor: googleLoading ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 5, transition: "all 0.2s" }}
      onMouseEnter={(e) => { if (!googleLoading) e.currentTarget.style.background = "rgba(196,167,136,0.22)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(196,167,136,0.15)"; }}
    >
      {googleLoading ? "登入中..." : (
        <>
          <svg width="12" height="12" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Google 登入
        </>
      )}
    </button>
  );
};

/* ════════════════════════════════════════════
   CreatePlayerModal — modified: accepts currentUser, prefills, hides pw for Google users
   ════════════════════════════════════════════ */
const CreatePlayerModal = ({ open, onClose, onSubmit, currentUser }) => {
  const [form, setForm] = useState({ nickname: "", experience: "", level: "中階", area: "", position: "", height: "", gender: "", timeSlots: [], intro: "", password: "", skills: { serve: 0, receive: 0, attack: 0, set: 0, block: 0, fitness: 0 } });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (open) {
      const defaultNickname = currentUser?.displayName || "";
      setForm({ nickname: defaultNickname, experience: "", level: "中階", area: "", position: "", height: "", gender: "", timeSlots: [], intro: "", password: "", skills: { serve: 0, receive: 0, attack: 0, set: 0, block: 0, fitness: 0 } });
      setErrors({});
    }
  }, [open, currentUser]);

  const toggleSlot = (slot) => {
    setForm(f => ({ ...f, timeSlots: f.timeSlots.includes(slot) ? f.timeSlots.filter(s => s !== slot) : [...f.timeSlots, slot] }));
  };

  const handleSubmit = () => {
    const e = {};
    if (!form.nickname.trim()) e.nickname = "必填";
    if (!form.experience.trim()) e.experience = "必填";
    if (!form.area.trim()) e.area = "必填";
    if (!currentUser && !form.password) e.password = "必填（用來保護你的資料）";
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    onSubmit({ nickname: form.nickname.trim(), experience: form.experience.trim(), level: form.level, area: form.area.trim(), position: form.position || "", height: form.height || "", gender: form.gender || "", timeSlots: form.timeSlots, intro: form.intro.trim(), password: form.password, skills: form.skills });
  };

  if (!open) return null;
  const inp = (label, field, opts = {}) => (
    <div style={{ marginBottom: 14 }} key={field}>
      <label style={labelStyle}>{label}{opts.required && " *"}</label>
      {opts.children || <input value={form[field]} onChange={(e) => { setForm(f => ({...f, [field]: e.target.value})); if (errors[field]) setErrors(er => ({...er, [field]: ""})); }} type={opts.type || "text"} placeholder={opts.placeholder} style={{ ...inputStyle, borderColor: errors[field] ? "#C85A5A" : "rgba(180,165,130,0.22)" }} onFocus={(e) => { e.target.style.borderColor = "#C4A788"; }} onBlur={(e) => { e.target.style.borderColor = errors[field] ? "#C85A5A" : "rgba(180,165,130,0.22)"; }}/>}
      {errors[field] && <div style={{ fontSize: 11, color: "#C85A5A", marginTop: 4 }}>{errors[field]}</div>}
    </div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(30,58,95,0.25)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 901, maxHeight: "92vh", overflowY: "auto", background: "linear-gradient(180deg, #FFF9EC, #FFF9EC)", borderRadius: "24px 24px 0 0", border: "1px solid rgba(180,165,130,0.18)", borderBottom: "none", animation: "slideUpModal 0.35s cubic-bezier(0.16,1,0.3,1)", boxShadow: "0 -10px 60px rgba(30,58,95,0.20)" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}><div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(180,165,130,0.35)" }}/></div>
        <div style={{ padding: "8px 24px 32px", maxWidth: 520, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#C4A788" }}>🙋 註冊球員資料</h2>
            <button onClick={onClose} style={{ background: "rgba(180,165,130,0.15)", border: "none", borderRadius: 10, padding: 8, cursor: "pointer", color: "#5A7B9A", display: "flex" }}><CloseIcon/></button>
          </div>

          {/* Google 登入者橫幅 */}
          {currentUser && (
            <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 12, background: "rgba(127,168,124,0.15)", border: "1px solid rgba(127,168,124,0.32)", display: "flex", alignItems: "center", gap: 10 }}>
              {currentUser.photoURL && <img src={currentUser.photoURL} alt="" style={{ width: 32, height: 32, borderRadius: "50%", border: "2px solid rgba(127,168,124,0.4)" }}/>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#7FA87C", fontWeight: 700, marginBottom: 2 }}>✓ 已用 Google 登入</div>
                <div style={{ fontSize: 13, color: "#1E3A5F", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentUser.displayName}</div>
              </div>
            </div>
          )}

          {inp("暱稱", "nickname", { required: true, placeholder: "你想被怎麼稱呼？" })}
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>{inp("球齡", "experience", { required: true, placeholder: "例：3年" })}</div>
            <div style={{ flex: 1 }}>{inp("程度", "level", { children:
              <select value={form.level} onChange={(e) => setForm(f => ({...f, level: e.target.value}))} style={{ ...inputStyle, cursor: "pointer" }}>{LEVELS_INPUT.map(l => <option key={l} value={l}>{l}</option>)}</select>
            })}</div>
          </div>
          {inp("常打地區", "area", { required: true, placeholder: "例：大安區、信義區" })}
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>{inp("慣用位置（選填）", "position", { children:
              <select value={form.position} onChange={(e) => setForm(f => ({...f, position: e.target.value}))} style={{ ...inputStyle, cursor: "pointer" }}><option value="">-- 選擇 --</option>{POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}</select>
            })}</div>
            <div style={{ flex: 1 }}>{inp("性別（選填）", "gender", { children:
              <select value={form.gender} onChange={(e) => setForm(f => ({...f, gender: e.target.value}))} style={{ ...inputStyle, cursor: "pointer" }}><option value="">-- 選擇 --</option><option value="男">男</option><option value="女">女</option><option value="不透露">不透露</option></select>
            })}</div>
          </div>
          {inp("身高 cm（選填）", "height", { type: "number", placeholder: "例：175" })}

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>可打時段（多選）</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {TIME_SLOTS.map(slot => (
                <button key={slot} onClick={() => toggleSlot(slot)}
                  style={{ padding: "6px 14px", borderRadius: 10, border: "1px solid", borderColor: form.timeSlots.includes(slot) ? "#C4A788" : "rgba(180,165,130,0.28)", background: form.timeSlots.includes(slot) ? "rgba(196,167,136,0.18)" : "transparent", color: form.timeSlots.includes(slot) ? "#C4A788" : "var(--text-secondary)", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
                >{slot}</button>
              ))}
            </div>
          </div>

          {inp("自我介紹（選填）", "intro", { children:
            <textarea value={form.intro} onChange={(e) => setForm(f => ({...f, intro: e.target.value}))} placeholder="例：週末固定打球，喜歡 6-2 陣型，歡迎約打！" rows={3} style={{ ...inputStyle, resize: "vertical", minHeight: 60 }} onFocus={(e) => { e.target.style.borderColor = "#C4A788"; }} onBlur={(e) => { e.target.style.borderColor = "rgba(180,165,130,0.22)"; }}/>
          })}

          {/* Skill evaluation */}
          <div style={{ marginBottom: 18, padding: "16px", borderRadius: 14, background: "rgba(196,167,136,0.08)", border: "1px solid rgba(196,167,136,0.22)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#C4A788" }}>📊 技能自評</span>
              <span style={{ fontSize: 11, color: "#8A7F6A" }}>選擇最符合你的描述</span>
            </div>
            {Object.values(form.skills).some(v => v > 0) && (
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
                <RadarChart skills={form.skills} size={140}/>
              </div>
            )}
            {SKILL_DIMS.map(dim => (
              <div key={dim.key} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>{dim.label}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {dim.descs.map((desc, i) => {
                    const lv = i + 1;
                    const selected = form.skills[dim.key] === lv;
                    return (
                      <button key={lv} onClick={() => setForm(f => ({ ...f, skills: { ...f.skills, [dim.key]: selected ? 0 : lv } }))}
                        style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid", borderColor: selected ? "#C4A788" : "rgba(180,165,130,0.18)", background: selected ? "rgba(196,167,136,0.18)" : "transparent", cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}>
                        <span style={{ minWidth: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, background: selected ? "#C4A788" : "rgba(180,165,130,0.15)", color: selected ? "#fff" : "#5A7B9A", flexShrink: 0 }}>{lv}</span>
                        <div>
                          <span style={{ fontSize: 10, color: selected ? "#C4A788" : "#8A7F6A", fontWeight: 600 }}>{LEVEL_TAGS[i]}</span>
                          <div style={{ fontSize: 12, color: selected ? "var(--text-primary)" : "var(--text-secondary)", lineHeight: 1.5 }}>{desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Password field only for guest users */}
          {!currentUser && inp("設定密碼（用來保護你的資料）", "password", { type: "password", required: true, placeholder: "之後編輯/刪除時需要" })}

          <button onClick={handleSubmit}
            style={{ width: "100%", padding: "14px", borderRadius: 14, border: "none", background: "linear-gradient(135deg, #C4A788, #A88B6B)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
            onMouseEnter={(e) => { e.target.style.transform = "scale(1.02)"; }}
            onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; }}
          >✅ 發佈球員資料</button>
        </div>
      </div>
    </>
  );
};

/* ════════════════════════════════════════════
   Weekly Record Modal
   ════════════════════════════════════════════ */
const WeeklyRecordModal = ({ open, onClose, player, onSave }) => {
  const week = getCurrentWeek();
  const existing = player?.weeklyRecords?.find(r => r.week === week);
  const [played, setPlayed] = useState("");
  const [won, setWon] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open && player) {
      setPlayed(existing ? String(existing.played) : "");
      setWon(existing ? String(existing.won) : "");
      setError("");
    }
  }, [open, player]);

  if (!open || !player) return null;

  const handleSubmit = () => {
    const p = Number(played), w = Number(won);
    if (!played || p < 0) { setError("請輸入打了幾場"); return; }
    if (!won && won !== "0" && won !== 0) { setError("請輸入贏了幾場"); return; }
    if (w < 0) { setError("勝場不能為負數"); return; }
    if (w > p) { setError("勝場不能超過總場數"); return; }
    onSave(player.id, p, w);
  };

  const stats = calcWinStats(player.weeklyRecords);

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(30,58,95,0.30)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 901, width: "min(420px, 92vw)", background: "linear-gradient(180deg, #FFF9EC, #FFF9EC)", borderRadius: 20, border: "1px solid rgba(232,155,94,0.3)", padding: "28px 24px", animation: "fadeIn 0.25s ease", boxShadow: "0 20px 60px rgba(30,58,95,0.20)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 20 }}>📊</span>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1E3A5F" }}>記錄本週戰績</h3>
        </div>
        <p style={{ fontSize: 12, color: "#5A7B9A", marginBottom: 16, lineHeight: 1.5 }}>
          {week}{existing ? "（已有紀錄，提交會覆蓋）" : ""}
        </p>

        {stats && (
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <div style={{ flex: 1, textAlign: "center", padding: "8px", borderRadius: 8, background: "rgba(232,155,94,0.12)" }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#E89B5E", fontFamily: "'Space Mono', monospace" }}>{stats.rate}%</div>
              <div style={{ fontSize: 10, color: "#8A7F6A" }}>總勝率</div>
            </div>
            <div style={{ flex: 1, textAlign: "center", padding: "8px", borderRadius: 8, background: "rgba(127,168,124,0.12)" }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#7FA87C", fontFamily: "'Space Mono', monospace" }}>{stats.totalWon}</div>
              <div style={{ fontSize: 10, color: "#8A7F6A" }}>總勝場</div>
            </div>
            <div style={{ flex: 1, textAlign: "center", padding: "8px", borderRadius: 8, background: "rgba(90,143,168,0.12)" }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#5A8FA8", fontFamily: "'Space Mono', monospace" }}>{stats.totalPlayed}</div>
              <div style={{ fontSize: 10, color: "#8A7F6A" }}>總場數</div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>本週打了幾場 *</label>
            <input type="number" min="0" max="50" value={played} onChange={(e) => { setPlayed(e.target.value); setError(""); }}
              placeholder="例：5"
              style={{ ...inputStyle, borderColor: error && !played ? "#C85A5A" : "rgba(180,165,130,0.22)" }}
              onFocus={(e) => { e.target.style.borderColor = "#E89B5E"; }}
              onBlur={(e) => { e.target.style.borderColor = "rgba(180,165,130,0.22)"; }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>贏了幾場 *</label>
            <input type="number" min="0" max="50" value={won} onChange={(e) => { setWon(e.target.value); setError(""); }}
              placeholder="例：3"
              style={{ ...inputStyle, borderColor: error && (!won && won !== "0") ? "#C85A5A" : "rgba(180,165,130,0.22)" }}
              onFocus={(e) => { e.target.style.borderColor = "#E89B5E"; }}
              onBlur={(e) => { e.target.style.borderColor = "rgba(180,165,130,0.22)"; }}
            />
          </div>
        </div>

        {played && won !== "" && Number(played) > 0 && (
          <div style={{ textAlign: "center", marginBottom: 14, padding: "10px", borderRadius: 10, background: "rgba(232,155,94,0.15)" }}>
            <span style={{ fontSize: 24, fontWeight: 800, color: "#E89B5E", fontFamily: "'Space Mono', monospace" }}>
              {Math.round((Number(won) / Number(played)) * 100)}%
            </span>
            <span style={{ fontSize: 12, color: "#8A7F6A", marginLeft: 8 }}>
              {won}W {Number(played) - Number(won)}L
            </span>
          </div>
        )}

        {error && <div style={{ fontSize: 12, color: "#C85A5A", marginBottom: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(180,165,130,0.28)", background: "transparent", color: "#5A7B9A", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>取消</button>
          <button onClick={handleSubmit}
            style={{ flex: 2, padding: "12px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #E89B5E, #D4855F)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
            onMouseEnter={(e) => { e.target.style.transform = "scale(1.02)"; }}
            onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; }}
          >📊 記錄戰績</button>
        </div>
      </div>
    </>
  );
};

const EditPlayerModal = ({ open, onClose, player, onSave, onDelete }) => {
  const [form, setForm] = useState({});
  useEffect(() => {
    if (open && player) setForm({ nickname: player.nickname || "", experience: player.experience || "", level: player.level || "中階", area: player.area || "", position: player.position || "", height: player.height || "", gender: player.gender || "", timeSlots: player.timeSlots || [], intro: player.intro || "", skills: player.skills || { serve: 0, receive: 0, attack: 0, set: 0, block: 0, fitness: 0 } });
  }, [open, player]);

  const toggleSlot = (slot) => {
    setForm(f => ({ ...f, timeSlots: f.timeSlots.includes(slot) ? f.timeSlots.filter(s => s !== slot) : [...f.timeSlots, slot] }));
  };

  if (!open || !player) return null;
  const inp = (label, field, opts = {}) => (
    <div style={{ marginBottom: 14 }} key={field}>
      <label style={labelStyle}>{label}</label>
      {opts.children || <input value={form[field] || ""} onChange={(e) => setForm(f => ({...f, [field]: e.target.value}))} type={opts.type || "text"} placeholder={opts.placeholder} style={inputStyle} onFocus={(e) => { e.target.style.borderColor = "#C4A788"; }} onBlur={(e) => { e.target.style.borderColor = "rgba(180,165,130,0.22)"; }}/>}
    </div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(30,58,95,0.25)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 901, maxHeight: "92vh", overflowY: "auto", background: "linear-gradient(180deg, #FFF9EC, #FFF9EC)", borderRadius: "24px 24px 0 0", border: "1px solid rgba(180,165,130,0.18)", borderBottom: "none", animation: "slideUpModal 0.35s cubic-bezier(0.16,1,0.3,1)", boxShadow: "0 -10px 60px rgba(30,58,95,0.20)" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}><div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(180,165,130,0.35)" }}/></div>
        <div style={{ padding: "8px 24px 32px", maxWidth: 520, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#C4A788" }}>✏️ 編輯球員資料</h2>
            <button onClick={onClose} style={{ background: "rgba(180,165,130,0.15)", border: "none", borderRadius: 10, padding: 8, cursor: "pointer", color: "#5A7B9A", display: "flex" }}><CloseIcon/></button>
          </div>
          {inp("暱稱 *", "nickname", { placeholder: "你想被怎麼稱呼？" })}
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>{inp("球齡 *", "experience", { placeholder: "例：3年" })}</div>
            <div style={{ flex: 1 }}>{inp("程度", "level", { children: <select value={form.level} onChange={(e) => setForm(f => ({...f, level: e.target.value}))} style={{ ...inputStyle, cursor: "pointer" }}>{LEVELS_INPUT.map(l => <option key={l} value={l}>{l}</option>)}</select> })}</div>
          </div>
          {inp("常打地區 *", "area", { placeholder: "例：大安區" })}
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>{inp("慣用位置", "position", { children: <select value={form.position} onChange={(e) => setForm(f => ({...f, position: e.target.value}))} style={{ ...inputStyle, cursor: "pointer" }}><option value="">--</option>{POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}</select> })}</div>
            <div style={{ flex: 1 }}>{inp("性別", "gender", { children: <select value={form.gender} onChange={(e) => setForm(f => ({...f, gender: e.target.value}))} style={{ ...inputStyle, cursor: "pointer" }}><option value="">--</option><option value="男">男</option><option value="女">女</option><option value="不透露">不透露</option></select> })}</div>
          </div>
          {inp("身高 cm", "height", { type: "number", placeholder: "175" })}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>可打時段</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {TIME_SLOTS.map(slot => (
                <button key={slot} onClick={() => toggleSlot(slot)} style={{ padding: "6px 14px", borderRadius: 10, border: "1px solid", borderColor: form.timeSlots?.includes(slot) ? "#C4A788" : "rgba(180,165,130,0.28)", background: form.timeSlots?.includes(slot) ? "rgba(196,167,136,0.18)" : "transparent", color: form.timeSlots?.includes(slot) ? "#C4A788" : "var(--text-secondary)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{slot}</button>
              ))}
            </div>
          </div>
          {inp("自我介紹", "intro", { children: <textarea value={form.intro} onChange={(e) => setForm(f => ({...f, intro: e.target.value}))} placeholder="歡迎約打！" rows={3} style={{ ...inputStyle, resize: "vertical", minHeight: 60 }} onFocus={(e) => { e.target.style.borderColor = "#C4A788"; }} onBlur={(e) => { e.target.style.borderColor = "rgba(180,165,130,0.22)"; }}/> })}

          <div style={{ marginBottom: 18, padding: "16px", borderRadius: 14, background: "rgba(196,167,136,0.08)", border: "1px solid rgba(196,167,136,0.22)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#C4A788" }}>📊 技能自評</span>
            </div>
            {form.skills && Object.values(form.skills).some(v => v > 0) && (
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
                <RadarChart skills={form.skills} size={140}/>
              </div>
            )}
            {SKILL_DIMS.map(dim => (
              <div key={dim.key} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>{dim.label}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {dim.descs.map((desc, i) => {
                    const lv = i + 1;
                    const selected = form.skills?.[dim.key] === lv;
                    return (
                      <button key={lv} onClick={() => setForm(f => ({ ...f, skills: { ...f.skills, [dim.key]: selected ? 0 : lv } }))}
                        style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid", borderColor: selected ? "#C4A788" : "rgba(180,165,130,0.18)", background: selected ? "rgba(196,167,136,0.18)" : "transparent", cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}>
                        <span style={{ minWidth: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, background: selected ? "#C4A788" : "rgba(180,165,130,0.15)", color: selected ? "#fff" : "#5A7B9A", flexShrink: 0 }}>{lv}</span>
                        <div>
                          <span style={{ fontSize: 10, color: selected ? "#C4A788" : "#8A7F6A", fontWeight: 600 }}>{LEVEL_TAGS[i]}</span>
                          <div style={{ fontSize: 12, color: selected ? "var(--text-primary)" : "var(--text-secondary)", lineHeight: 1.5 }}>{desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} style={{ flex: 1, padding: "14px", borderRadius: 14, border: "1px solid rgba(180,165,130,0.28)", background: "transparent", color: "#5A7B9A", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>取消</button>
            <button onClick={() => onSave(player.id, form)} style={{ flex: 2, padding: "14px", borderRadius: 14, border: "none", background: "linear-gradient(135deg, #C4A788, #A88B6B)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>💾 儲存</button>
          </div>
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px dashed rgba(200,90,90,0.25)" }}>
            <button onClick={() => onDelete(player.id)} style={{ width: "100%", padding: "12px", borderRadius: 12, border: "1px solid rgba(200,90,90,0.35)", background: "rgba(200,90,90,0.12)", color: "#C85A5A", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🗑️ 刪除我的資料</button>
          </div>
        </div>
      </div>
    </>
  );
};

const LAST_FORM_KEY = "vb_last_create_form";

const CreateSessionModal = ({ open, onClose, onSubmit }) => {
  const defaultForm = { courtName: "", area: "", date: getToday(), startTime: "19:00", currentPeople: "1", maxPeople: "16", level: "中階", fee: "", hostName: "", signupUrl: "", notes: "", password: "" };

  const loadSavedForm = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(LAST_FORM_KEY));
      if (saved) {
        return { ...defaultForm, ...saved, date: getToday(), startTime: saved.startTime || "19:00" };
      }
    } catch {}
    return defaultForm;
  };

  const [form, setForm] = useState(defaultForm);
  const [errors, setErrors] = useState({});
  const [step, setStep] = useState(1);

  useEffect(() => {
    if (open) {
      setForm(loadSavedForm());
      setStep(1);
      setErrors({});
    }
  }, [open]);

  const handleSubmit = () => {
    const e = {};
    if (!form.fee || Number(form.fee) <= 0) e.fee = "請輸入費用";
    if (Number(form.currentPeople) < 1) e.currentPeople = "至少要有1人";
    if (Number(form.maxPeople) < 12) e.maxPeople = "上限至少12人";
    if (Number(form.currentPeople) > Number(form.maxPeople)) e.currentPeople = "不能超過上限人數";
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    try {
      const toSave = { courtName: form.courtName, area: form.area, startTime: form.startTime, currentPeople: form.currentPeople, maxPeople: form.maxPeople, level: form.level, fee: form.fee, hostName: form.hostName, signupUrl: form.signupUrl, notes: form.notes };
      localStorage.setItem(LAST_FORM_KEY, JSON.stringify(toSave));
    } catch {}

    onSubmit({ courtName: form.courtName.trim(), area: form.area.trim(), date: form.date, time: form.startTime, registered: Number(form.currentPeople), max: Number(form.maxPeople), min: 12, level: form.level, fee: Number(form.fee), host: form.hostName.trim(), signupUrl: form.signupUrl.trim(), notes: form.notes.trim(), password: form.password });
    setStep(1); setErrors({});
  };

  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(30,58,95,0.25)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 901, maxHeight: "92vh", overflowY: "auto", background: "linear-gradient(180deg, #FFF9EC, #FFF9EC)", borderRadius: "24px 24px 0 0", border: "1px solid rgba(180,165,130,0.18)", borderBottom: "none", animation: "slideUpModal 0.35s cubic-bezier(0.16,1,0.3,1)", boxShadow: "0 -10px 60px rgba(30,58,95,0.20)" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}><div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(180,165,130,0.35)" }}/></div>
        <div style={{ padding: "8px 24px 32px", maxWidth: 520, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "#E89B5E", marginBottom: 4 }}>🏐 我要開場</h2>
              <p style={{ fontSize: 12, color: "#8A7F6A" }}>{step === 1 ? "步驟 1/2 — 場地與主揪" : "步驟 2/2 — 場次細節"}</p>
            </div>
            <button onClick={onClose} style={{ background: "rgba(180,165,130,0.15)", border: "none", borderRadius: 10, padding: 8, cursor: "pointer", color: "#5A7B9A", display: "flex" }}><CloseIcon/></button>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>{[1,2].map(s => (<div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: s <= step ? "#E89B5E" : "rgba(180,165,130,0.22)", transition: "background 0.3s ease" }}/>))}</div>

          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "fadeIn 0.3s ease" }}>
              <div>
                <label style={labelStyle}>場地名稱 *</label>
                <input value={form.courtName} onChange={(e) => setForm({...form, courtName: e.target.value})} placeholder="例：大安運動中心、XX國小體育館" style={{...inputStyle, borderColor: errors.courtName ? "#C85A5A" : "rgba(180,165,130,0.22)"}} onFocus={(e)=>{e.target.style.borderColor="#E89B5E";}} onBlur={(e)=>{e.target.style.borderColor=errors.courtName?"#C85A5A":"rgba(180,165,130,0.22)";}}/>
                {errors.courtName && <span style={{ fontSize: 11, color: "#C85A5A", marginTop: 4, display: "block" }}>{errors.courtName}</span>}
              </div>
              <div>
                <label style={labelStyle}>地區 *</label>
                <input value={form.area} onChange={(e) => setForm({...form, area: e.target.value})} placeholder="例：大安區、信義區、新莊區" style={{...inputStyle, borderColor: errors.area ? "#C85A5A" : "rgba(180,165,130,0.22)"}} onFocus={(e)=>{e.target.style.borderColor="#E89B5E";}} onBlur={(e)=>{e.target.style.borderColor=errors.area?"#C85A5A":"rgba(180,165,130,0.22)";}}/>
                {errors.area && <span style={{ fontSize: 11, color: "#C85A5A", marginTop: 4, display: "block" }}>{errors.area}</span>}
              </div>
              <div>
                <label style={labelStyle}>你的名稱（暱稱）*</label>
                <input value={form.hostName} onChange={(e) => setForm({...form, hostName: e.target.value})} placeholder="讓大家知道誰在揪" style={{...inputStyle, borderColor: errors.hostName ? "#C85A5A" : "rgba(180,165,130,0.22)"}} onFocus={(e)=>{e.target.style.borderColor="#E89B5E";}} onBlur={(e)=>{e.target.style.borderColor=errors.hostName?"#C85A5A":"rgba(180,165,130,0.22)";}}/>
                {errors.hostName && <span style={{ fontSize: 11, color: "#C85A5A", marginTop: 4, display: "block" }}>{errors.hostName}</span>}
              </div>
              <div>
                <label style={labelStyle}>🔒 編輯密碼 *</label>
                <input type="password" value={form.password} onChange={(e) => setForm({...form, password: e.target.value})} placeholder="設定密碼，之後修改場次時需要驗證" style={{...inputStyle, borderColor: errors.password ? "#C85A5A" : "rgba(180,165,130,0.22)"}} onFocus={(e)=>{e.target.style.borderColor="#E89B5E";}} onBlur={(e)=>{e.target.style.borderColor=errors.password?"#C85A5A":"rgba(180,165,130,0.22)";}}/>
                {errors.password && <span style={{ fontSize: 11, color: "#C85A5A", marginTop: 4, display: "block" }}>{errors.password}</span>}
                <span style={{ fontSize: 11, color: "#8A7F6A", marginTop: 4, display: "block" }}>此密碼用於日後編輯場次資訊，請牢記</span>
              </div>
              <button onClick={() => { const e = {}; if (!form.courtName.trim()) e.courtName = "請輸入場地名稱"; if (!form.area.trim()) e.area = "請輸入地區"; if (!form.hostName.trim()) e.hostName = "請輸入你的名稱"; if (!form.password) e.password = "請設定編輯密碼"; setErrors(e); if (Object.keys(e).length === 0) setStep(2); }}
                style={{ padding: "14px", borderRadius: 14, border: "none", marginTop: 4, background: "linear-gradient(135deg, #E89B5E, #D4855F)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={(e) => { e.target.style.transform = "scale(1.02)"; e.target.style.boxShadow = "0 4px 20px rgba(232,155,94,0.3)"; }}
                onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; e.target.style.boxShadow = "none"; }}
              >下一步 →</button>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "fadeIn 0.3s ease" }}>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}><label style={labelStyle}>日期 *</label><select value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} style={{...inputStyle, cursor: "pointer"}}>{DATES.map(d => <option key={d.value} value={d.value}>{d.label} ({d.value.slice(5).replace("-","/")})</option>)}</select></div>
                <div style={{ flex: 1 }}><label style={labelStyle}>開始時間 *</label><select value={form.startTime} onChange={(e) => setForm({...form, startTime: e.target.value})} style={{...inputStyle, cursor: "pointer"}}>{HOURS.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>目前已有幾人</label>
                  <input type="number" min="1" max="18" value={form.currentPeople} onChange={(e) => setForm({...form, currentPeople: e.target.value})} style={{...inputStyle, borderColor: errors.currentPeople ? "#C85A5A" : "rgba(180,165,130,0.22)"}}/>
                  {errors.currentPeople && <span style={{ fontSize: 11, color: "#C85A5A", marginTop: 4, display: "block" }}>{errors.currentPeople}</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>人數上限</label>
                  <input type="number" min="12" max="24" value={form.maxPeople} onChange={(e) => setForm({...form, maxPeople: e.target.value})} style={{...inputStyle, borderColor: errors.maxPeople ? "#C85A5A" : "rgba(180,165,130,0.22)"}}/>
                  {errors.maxPeople && <span style={{ fontSize: 11, color: "#C85A5A", marginTop: 4, display: "block" }}>{errors.maxPeople}</span>}
                </div>
              </div>
              {Number(form.currentPeople) >= 1 && Number(form.currentPeople) < 12 && (
                <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(232,155,94,0.15)", border: "1px solid rgba(232,155,94,0.25)", fontSize: 13, color: "#E89B5E" }}>🔥 還差 <strong>{12 - Number(form.currentPeople)}</strong> 人可以成團（最低 12 人）</div>
              )}
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}><label style={labelStyle}>程度 *</label><select value={form.level} onChange={(e) => setForm({...form, level: e.target.value})} style={{...inputStyle, cursor: "pointer"}}>{LEVELS_INPUT.map(l => <option key={l} value={l}>{l}</option>)}</select></div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>每人費用 (NT$) *</label>
                  <input type="number" min="0" step="10" value={form.fee} onChange={(e) => setForm({...form, fee: e.target.value})} placeholder="例：150" style={{...inputStyle, borderColor: errors.fee ? "#C85A5A" : "rgba(180,165,130,0.22)"}}/>
                  {errors.fee && <span style={{ fontSize: 11, color: "#C85A5A", marginTop: 4, display: "block" }}>{errors.fee}</span>}
                </div>
              </div>
              <div>
                <label style={labelStyle}>報名連結（選填）</label>
                <input value={form.signupUrl} onChange={(e) => setForm({...form, signupUrl: e.target.value})} placeholder="例：https://www.facebook.com/groups/..."
                  style={{
                    ...inputStyle,
                    borderColor: form.signupUrl && !isValidUrl(form.signupUrl) ? "#C85A5A" : (form.signupUrl && isValidUrl(form.signupUrl) ? "#7FA87C" : "rgba(180,165,130,0.22)")
                  }}
                  onFocus={(e)=>{
                    if (!form.signupUrl) e.target.style.borderColor = "#E89B5E";
                  }}
                  onBlur={(e)=>{
                    e.target.style.borderColor = form.signupUrl && !isValidUrl(form.signupUrl) ? "#C85A5A" : (form.signupUrl && isValidUrl(form.signupUrl) ? "#7FA87C" : "rgba(180,165,130,0.22)");
                  }}
                />
                {form.signupUrl && !isValidUrl(form.signupUrl) ? (
                  <span style={{ fontSize: 11, color: "#C85A5A", marginTop: 4, display: "block" }}>⚠️ 這不是有效的網址，請以 http:// 或 https:// 開頭（留空也 OK）</span>
                ) : form.signupUrl && isValidUrl(form.signupUrl) ? (
                  <span style={{ fontSize: 11, color: "#7FA87C", marginTop: 4, display: "block" }}>✓ 網址格式正確</span>
                ) : (
                  <span style={{ fontSize: 11, color: "#8A7F6A", marginTop: 4, display: "block" }}>貼上 FB 社團、LINE 群組或其他報名頁面的網址</span>
                )}
              </div>
              <div>
                <label style={labelStyle}>備註（選填）</label>
                <textarea value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} placeholder="例：需要自備球鞋、有停車場、冷氣開放..." rows={2} style={{...inputStyle, resize: "vertical", minHeight: 60}} onFocus={(e)=>{e.target.style.borderColor="#E89B5E";}} onBlur={(e)=>{e.target.style.borderColor="rgba(180,165,130,0.22)";}}/>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button onClick={() => setStep(1)} style={{ flex: 1, padding: "14px", borderRadius: 14, border: "1px solid rgba(180,165,130,0.28)", background: "transparent", color: "#5A7B9A", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>← 上一步</button>
                <button onClick={handleSubmit} style={{ flex: 2, padding: "14px", borderRadius: 14, border: "none", background: "linear-gradient(135deg, #E89B5E, #D4855F)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={(e) => { e.target.style.transform = "scale(1.02)"; e.target.style.boxShadow = "0 4px 20px rgba(232,155,94,0.3)"; }}
                  onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; e.target.style.boxShadow = "none"; }}
                >🏐 發佈場次</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

/* ════════════════════════════════════════════
   Main App
   ════════════════════════════════════════════ */
export default function VolleyballMatcher() {
  const [activeTab, setActiveTab] = useState("sessions");
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [selectedArea, setSelectedArea] = useState("全部");
  const [selectedLevel, setSelectedLevel] = useState("全部");
  const [sortBy, setSortBy] = useState("need");
  const [joinedSessions, setJoinedSessions] = useState(new Set());
  const [showToast, setShowToast] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [commentTarget, setCommentTarget] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminLoginModal, setShowAdminLoginModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareData, setShareData] = useState(null);
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [notifyTarget, setNotifyTarget] = useState(null);
  const [bindingCode, setBindingCode] = useState(null);
  const [showBindingModal, setShowBindingModal] = useState(false);
  const [players, setPlayers] = useState([]);
  const [showCreatePlayerModal, setShowCreatePlayerModal] = useState(false);
  const [showEditPlayerModal, setShowEditPlayerModal] = useState(false);
  const [editPlayerTarget, setEditPlayerTarget] = useState(null);
  const [showPlayerPasswordModal, setShowPlayerPasswordModal] = useState(false);
  const [playerFilterArea, setPlayerFilterArea] = useState("全部");
  const [playerFilterLevel, setPlayerFilterLevel] = useState("全部");
  const [currentUser, setCurrentUser] = useState(null);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [recordTarget, setRecordTarget] = useState(null);

  // NEW: auth flow state
  const [showLoginChoiceModal, setShowLoginChoiceModal] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // NEW: share card state
  const [showShareCardModal, setShowShareCardModal] = useState(false);
  const [shareCardTarget, setShareCardTarget] = useState(null);

  // NEW: member center state
  const [showMemberCenterModal, setShowMemberCenterModal] = useState(false);

  const toast = (msg, duration = 2500, type = "success") => { setShowToast({ msg, type }); setTimeout(() => setShowToast(null), duration); };

  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const JOINED_KEY = "vb_joined_sessions";
  const WAITLIST_KEY = "vb_waitlist_sessions";
  const loadJoined = () => {
    try { return new Set(JSON.parse(localStorage.getItem(JOINED_KEY) || "[]")); } catch { return new Set(); }
  };
  const saveJoined = (set) => {
    try { localStorage.setItem(JOINED_KEY, JSON.stringify([...set])); } catch {}
  };
  const loadWaitlist = () => {
    try { return new Set(JSON.parse(localStorage.getItem(WAITLIST_KEY) || "[]")); } catch { return new Set(); }
  };
  const saveWaitlist = (set) => {
    try { localStorage.setItem(WAITLIST_KEY, JSON.stringify([...set])); } catch {}
  };

  const [waitlistedSessions, setWaitlistedSessions] = useState(new Set());

  useEffect(() => {
    setJoinedSessions(loadJoined());
    setWaitlistedSessions(loadWaitlist());
  }, []);

  const hasSessionStarted = (session) => {
    if (!session.date || !session.time) return false;
    const startStr = session.time.split("\u2013")[0].trim();
    const [h, m] = startStr.split(":").map(Number);
    const [y, mo, d] = session.date.split("-").map(Number);
    const sessionStart = new Date(y, mo - 1, d, h || 0, m || 0);
    return sessionStart.getTime() <= Date.now();
  };

  useEffect(() => {
    try {
      if (sessionStorage.getItem(ADMIN_SESSION_KEY) === "1") {
        setIsAdmin(true);
        return;
      }
    } catch {}
    const params = new URLSearchParams(window.location.search);
    if (params.get("admin") === "1") {
      setShowAdminLoginModal(true);
    }
  }, []);

  const handleAdminLogin = () => {
    setIsAdmin(true);
    try { sessionStorage.setItem(ADMIN_SESSION_KEY, "1"); } catch {}
    setShowAdminLoginModal(false);
    toast("🛡️ 管理者模式已啟動", 2500, "warn");
  };

  const handleAdminLogout = () => {
    if (!window.confirm("確定要登出管理者模式嗎？")) return;
    setIsAdmin(false);
    try { sessionStorage.removeItem(ADMIN_SESSION_KEY); } catch {}
    toast("已登出管理者模式", 2000);
  };

  useEffect(() => {
    const q = query(sessionsRef, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const list = [];
      snap.forEach(d => {
        const data = d.data();
        if (data.closed && !isAdmin) return;
        list.push({ id: d.id, ...data });
      });
      setSessions(list);
      list.forEach(s => { if (s.area && !AREAS_FILTER.includes(s.area)) AREAS_FILTER.push(s.area); });
      setLoading(false);
    }, (err) => {
      console.error("Firestore 讀取錯誤：", err);
      toast("連線失敗，請檢查網路或 Firebase 設定", 4000, "warn");
      setLoading(false);
    });
    return () => unsub();
  }, [isAdmin]);

  useEffect(() => {
    const q2 = query(collection(db, "players"), orderBy("createdAt", "desc"));
    const unsub2 = onSnapshot(q2, (snap) => {
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      setPlayers(list);
    }, (err) => console.error("Players 讀取錯誤：", err));
    return () => unsub2();
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user || null);
    });
    return () => unsub();
  }, []);

  // MODIFIED: handleGoogleLogin now accepts optional afterLogin param
  const handleGoogleLogin = async ({ afterLogin } = {}) => {
    setGoogleLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      toast("Google 登入成功 ✅");
      if (afterLogin === "register") {
        setShowLoginChoiceModal(false);
        // Small delay so auth state propagates
        setTimeout(() => {
          setShowCreatePlayerModal(true);
        }, 200);
      }
    } catch (err) {
      if (err.code !== "auth/popup-closed-by-user") {
        console.error(err);
        toast("登入失敗，請稍後再試", 3000, "warn");
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleGoogleLogout = async () => {
    try {
      await signOut(auth);
      toast("已登出", 2000);
    } catch (err) {
      console.error(err);
    }
  };

  // NEW: open FAB registration flow — decides if LoginChoiceModal or skip to CreatePlayerModal
  const handleOpenRegisterFlow = () => {
    if (currentUser) {
      // Already logged in — go straight to registration form
      setShowCreatePlayerModal(true);
    } else {
      // Not logged in — show Google vs guest choice
      setShowLoginChoiceModal(true);
    }
  };

  // NEW: LoginChoiceModal "use Google" click
  const handleChooseGoogle = () => {
    handleGoogleLogin({ afterLogin: "register" });
  };

  // NEW: LoginChoiceModal "use guest" click
  const handleChooseGuest = () => {
    setShowLoginChoiceModal(false);
    setShowCreatePlayerModal(true);
  };

  // NEW: header indicator login click (just login, no follow-up)
  const handleHeaderLogin = () => {
    handleGoogleLogin();
  };

  // NEW: open share card modal for a player
  const handleOpenShareCard = (player) => {
    setShareCardTarget(player);
    setShowShareCardModal(true);
  };

  // NEW: open member center modal
  const handleOpenMemberCenter = () => {
    setShowMemberCenterModal(true);
  };

  // NEW: edit a specific historical week record — opens WeeklyRecordModal with prefilled data
  // (The WeeklyRecordModal auto-detects the week based on `getCurrentWeek()` so editing old weeks
  //  requires us to pass the player as-is; modal will show this week's record OR allow overwriting.
  //  We keep this simple: just reopen the standard record modal, which lets them overwrite current week.)
  const handleEditHistoricalRecord = (player, record) => {
    // Simpler approach: open the regular WeeklyRecordModal for current week
    // For editing PAST weeks, we'd need a different modal. Keeping current behavior for now:
    // just jumping them to current week record since historical records are stored but we only
    // allow modifying the current week via the existing modal.
    // ALTERNATIVE: could inline-edit in the member center. For simplicity we just reopen modal.
    setRecordTarget(player);
    setShowRecordModal(true);
  };

  // NEW: merge duplicate player records for the current Google user
  const handleMergeDuplicates = async (duplicates) => {
    if (!duplicates || duplicates.length < 2) return;
    if (!window.confirm(`確定要合併這 ${duplicates.length} 筆重複資料嗎？\n\n系統會：\n• 保留最新的那筆作為主資料\n• 合併所有戰績紀錄（同週以場數較多為準）\n• 合併所有推薦（去重）\n• 刪除其他舊資料\n\n此動作無法復原。`)) return;

    try {
      // Sort by createdAt descending — newest first
      const sorted = [...duplicates].sort((a, b) => {
        const aTime = a.createdAt?.seconds || a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.seconds || b.createdAt?.toMillis?.() || 0;
        return bTime - aTime;
      });
      const primary = sorted[0];
      const toDelete = sorted.slice(1);

      // Merge weeklyRecords — if same week exists in multiple, keep the one with more games played
      const weekMap = new Map();
      duplicates.forEach(p => {
        (p.weeklyRecords || []).forEach(r => {
          const existing = weekMap.get(r.week);
          if (!existing || (r.played || 0) > (existing.played || 0)) {
            weekMap.set(r.week, r);
          }
        });
      });
      const mergedRecords = [...weekMap.values()].sort((a, b) => b.week.localeCompare(a.week)).slice(0, 52);

      // Merge recommendations — dedupe by fromUid
      const recMap = new Map();
      duplicates.forEach(p => {
        (p.recommendations || []).forEach(rec => {
          const key = rec.fromUid || rec.fromName || JSON.stringify(rec);
          if (!recMap.has(key)) recMap.set(key, rec);
        });
      });
      const mergedRecommendations = [...recMap.values()];

      // Latest wantToPlayUntil
      const mergedWantToPlayUntil = duplicates.reduce((max, p) => Math.max(max, p.wantToPlayUntil || 0), 0);

      // Update primary with merged data
      await updateDoc(doc(db, "players", primary.id), {
        weeklyRecords: mergedRecords,
        recommendations: mergedRecommendations,
        recommendCount: mergedRecommendations.length,
        wantToPlayUntil: mergedWantToPlayUntil,
      });

      // Delete the rest
      for (const p of toDelete) {
        await deleteDoc(doc(db, "players", p.id));
      }

      toast(`✅ 已合併 ${duplicates.length} 筆重複資料，保留最新的`, 3500);
    } catch (err) {
      console.error("Merge error:", err);
      toast("合併失敗，請稍後再試", 3000, "warn");
    }
  };

  const handleWantToPlay = async (player) => {
    if (!currentUser || player.uid !== currentUser.uid) {
      toast("請先用 Google 登入才能使用此功能", 3000, "warn");
      return;
    }
    try {
      const until = Date.now() + WANT_TO_PLAY_HOURS * 3600000;
      await updateDoc(doc(db, "players", player.id), { wantToPlayUntil: until });
      toast("已設定「想打球」狀態！6 小時後自動關閉 🏐");
    } catch (err) {
      console.error(err);
      toast("設定失敗", 3000, "warn");
    }
  };

  const handleOpenRecordModal = (player) => {
    setRecordTarget(player);
    setShowRecordModal(true);
  };

  const handleSaveWeeklyRecord = async (playerId, played, won) => {
    try {
      const week = getCurrentWeek();
      const player = players.find(p => p.id === playerId);
      if (!player) return;
      const records = player.weeklyRecords || [];
      const updated = records.filter(r => r.week !== week);
      updated.push({ week, played, won, recordedAt: Date.now() });
      updated.sort((a, b) => b.week.localeCompare(a.week));
      const trimmed = updated.slice(0, 52);
      await updateDoc(doc(db, "players", playerId), { weeklyRecords: trimmed });
      setShowRecordModal(false);
      setRecordTarget(null);
      toast("本週戰績已記錄 📊");
    } catch (err) {
      console.error(err);
      toast("記錄失敗", 3000, "warn");
    }
  };

  const generateBindingCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  };

  const handleJoin = async (sessionId) => {
    if (joinedSessions.has(sessionId)) return;
    const nj = new Set(joinedSessions); nj.add(sessionId);
    setJoinedSessions(nj); saveJoined(nj);
    try {
      await updateDoc(doc(db, "sessions", sessionId), { registered: increment(1) });

      const code = generateBindingCode();
      await setDoc(doc(db, "bindingCodes", code), {
        sessionId,
        createdAt: serverTimestamp(),
        used: false,
      });

      setBindingCode(code);
      setShowBindingModal(true);
    } catch (err) {
      console.error(err);
      const rollback = new Set(joinedSessions);
      setJoinedSessions(rollback); saveJoined(rollback);
      toast("報名失敗，請稍後再試", 3000, "warn");
    }
  };

  const handleCancelRegistration = async (sessionId) => {
    if (!joinedSessions.has(sessionId)) return;
    const nj = new Set(joinedSessions); nj.delete(sessionId);
    setJoinedSessions(nj); saveJoined(nj);
    try {
      await updateDoc(doc(db, "sessions", sessionId), { registered: increment(-1) });
      toast("已取消報名", 2500);
    } catch (err) {
      console.error(err);
      const rollback = new Set(joinedSessions);
      setJoinedSessions(rollback); saveJoined(rollback);
      toast("取消失敗，請稍後再試", 3000, "warn");
    }
  };

  const handleWaitlist = async (sessionId) => {
    if (waitlistedSessions.has(sessionId)) return;
    const nw = new Set(waitlistedSessions); nw.add(sessionId);
    setWaitlistedSessions(nw); saveWaitlist(nw);
    try {
      await updateDoc(doc(db, "sessions", sessionId), { waitlist: increment(1) });
      toast("已加入候補！等主揪通知你是否能補上 🕐", 3500, "warn");
    } catch (err) {
      console.error(err);
      const rollback = new Set(waitlistedSessions);
      setWaitlistedSessions(rollback); saveWaitlist(rollback);
      toast("候補失敗，請稍後再試", 3000, "warn");
    }
  };

  const handleCancelWaitlist = async (sessionId) => {
    if (!waitlistedSessions.has(sessionId)) return;
    const nw = new Set(waitlistedSessions); nw.delete(sessionId);
    setWaitlistedSessions(nw); saveWaitlist(nw);
    try {
      await updateDoc(doc(db, "sessions", sessionId), { waitlist: increment(-1) });
      toast("已取消候補", 2500);
    } catch (err) {
      console.error(err);
      const rollback = new Set(waitlistedSessions);
      setWaitlistedSessions(rollback); saveWaitlist(rollback);
      toast("取消失敗，請稍後再試", 3000, "warn");
    }
  };

  const handleCloseSession = async (sessionId) => {
    try {
      await updateDoc(doc(db, "sessions", sessionId), { closed: true });
      setShowEditModal(false);
      setEditTarget(null);
      toast("場次已關閉 ✅", 2500);
    } catch (err) {
      console.error(err);
      toast("關閉失敗，請稍後再試", 3000, "warn");
    }
  };

  const handleOpenCommentModal = (session) => {
    setCommentTarget(session);
    setShowCommentModal(true);
  };

  const handleAddComment = async (sessionId, text, authorName) => {
    try {
      const newComment = { text, author: authorName, createdAt: Date.now() };
      await updateDoc(doc(db, "sessions", sessionId), {
        comments: arrayUnion(newComment),
      });
      setShowCommentModal(false);
      setCommentTarget(null);
      toast("留言已發佈 💬", 2500);
    } catch (err) {
      console.error(err);
      toast("發佈失敗，請稍後再試", 3000, "warn");
    }
  };

  const handleAdminDelete = async (session) => {
    if (!isAdmin) return;
    const label = `${session.courtName || "場次"} ${session.date} ${session.time}`;
    if (!window.confirm(`⚠️ 確定要永久刪除此場次嗎？\n\n${label}\n\n此動作無法復原，資料會從 Firebase 徹底移除。`)) return;
    try {
      await deleteDoc(doc(db, "sessions", session.id));
      toast("場次已永久刪除 🗑️", 2500, "warn");
    } catch (err) {
      console.error(err);
      toast("刪除失敗，請稍後再試", 3000, "warn");
    }
  };

  const handleAdminAdjust = async (sessionId, field, delta) => {
    if (!isAdmin) return;
    const s = sessions.find(s => s.id === sessionId);
    if (!s) return;
    const current = s[field] || 0;
    if (current + delta < 0) {
      toast("數量不能小於 0", 2000, "warn");
      return;
    }
    try {
      await updateDoc(doc(db, "sessions", sessionId), { [field]: increment(delta) });
    } catch (err) {
      console.error(err);
      toast("調整失敗，請稍後再試", 3000, "warn");
    }
  };

  const handleCreateSession = async (data) => {
    try {
      await addDoc(sessionsRef, {
        courtName: data.courtName, area: data.area,
        date: data.date, time: data.time,
        registered: data.registered, max: data.max, min: data.min,
        level: data.level, fee: data.fee,
        host: data.host, signupUrl: data.signupUrl || "",
        notes: data.notes || "", password: data.password,
        createdAt: serverTimestamp(),
      });
      if (!AREAS_FILTER.includes(data.area)) AREAS_FILTER.push(data.area);
      setShowCreateModal(false);
      setSelectedDate(data.date);
      setShareData(data);
      setShowShareModal(true);
    } catch (err) {
      console.error(err);
      toast("發佈失敗，請稍後再試", 3000, "warn");
    }
  };

  const handleOpenShareModal = (session) => {
    setShareData(session);
    setShowShareModal(true);
  };

  const handleCreatePlayer = async (data) => {
    try {
      const playerData = { ...data, createdAt: serverTimestamp() };
      if (currentUser) {
        playerData.uid = currentUser.uid;
        playerData.photoURL = currentUser.photoURL || "";
        delete playerData.password;
      }
      await addDoc(collection(db, "players"), playerData);
      setShowCreatePlayerModal(false);
      toast("球員資料已發佈！🏐");
    } catch (err) {
      console.error(err);
      toast("發佈失敗，請稍後再試", 3000, "warn");
    }
  };

  const handleEditPlayerClick = (player) => {
    setEditPlayerTarget(player);
    if (currentUser && player.uid === currentUser.uid) {
      setShowEditPlayerModal(true);
    } else if (isAdmin) {
      setShowEditPlayerModal(true);
    } else {
      setShowPlayerPasswordModal(true);
    }
  };

  const handlePlayerPasswordVerify = (playerId, pw) => {
    const p = players.find(p => p.id === playerId);
    if (!p || p.password !== pw) return false;
    setShowPlayerPasswordModal(false);
    setShowEditPlayerModal(true);
    return true;
  };

  const handleSavePlayer = async (playerId, data) => {
    try {
      await updateDoc(doc(db, "players", playerId), data);
      setShowEditPlayerModal(false);
      setEditPlayerTarget(null);
      toast("資料已更新 ✅");
    } catch (err) {
      console.error(err);
      toast("更新失敗", 3000, "warn");
    }
  };

  const handleDeletePlayer = async (playerId) => {
    if (!window.confirm("確定要刪除你的球員資料嗎？此動作無法復原。")) return;
    try {
      await deleteDoc(doc(db, "players", playerId));
      setShowEditPlayerModal(false);
      setEditPlayerTarget(null);
      toast("球員資料已刪除 🗑️");
    } catch (err) {
      console.error(err);
      toast("刪除失敗", 3000, "warn");
    }
  };

  const handleOpenNotifyModal = (session) => {
    setNotifyTarget(session);
    setShowNotifyModal(true);
  };

  const handleSendLineNotification = async (sessionId, notifyType, customMessage, password) => {
    try {
      const resp = await fetch(FUNCTIONS_BASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, notifyType, customMessage, password }),
      });
      const data = await resp.json();
      if (!resp.ok) return { error: data.error || "Unknown error" };
      return data;
    } catch (err) {
      console.error("LINE notification error:", err);
      return { error: "網路錯誤，請檢查網路連線或 Functions URL 設定" };
    }
  };

  const findSessionInfo = (sessionId) => {
    const s = sessions.find(s => s.id === sessionId);
    if (!s) return null;
    return { session: s, courtName: s.courtName, area: s.area };
  };

  const handleEditClick = (session) => {
    const info = findSessionInfo(session.id);
    if (!info) return;
    setEditTarget(info);
    if (isAdmin) {
      setShowEditModal(true);
    } else {
      setShowPasswordModal(true);
    }
  };

  const handlePasswordVerify = (sessionId, pw) => {
    const info = findSessionInfo(sessionId);
    if (!info) return false;
    if (info.session.password !== pw) return false;
    setShowPasswordModal(false);
    setShowEditModal(true);
    return true;
  };

  const handleSaveEdit = async (sessionId, data) => {
    try {
      await updateDoc(doc(db, "sessions", sessionId), {
        courtName: data.courtName, area: data.area,
        date: data.date, time: data.time,
        registered: data.registered, max: data.max,
        level: data.level, fee: data.fee,
        host: data.host, signupUrl: data.signupUrl || "", notes: data.notes || "",
      });
      if (!AREAS_FILTER.includes(data.area)) AREAS_FILTER.push(data.area);
      setShowEditModal(false);
      setEditTarget(null);
      toast("場次已更新 ✅");
    } catch (err) {
      console.error(err);
      toast("更新失敗，請稍後再試", 3000, "warn");
    }
  };

  const _tickRef = nowTick;
  const allSessions = sessions
    .filter(s => !hasSessionStarted(s))
    .filter(s => s.date === selectedDate)
    .filter(s => selectedArea === "全部" || s.area === selectedArea)
    .filter(s => selectedLevel === "全部" || s.level === selectedLevel);
  const sorted = [...allSessions].sort((a,b) => { if (sortBy === "need") return getStatusPriority(a) - getStatusPriority(b); if (sortBy === "time") return a.time.localeCompare(b.time); if (sortBy === "fee") return a.fee - b.fee; return 0; });
  const totalPlayers = allSessions.reduce((sum,s) => sum + s.registered, 0);
  const needPeople = allSessions.filter(s => s.registered < s.min);
  const formed = allSessions.filter(s => s.registered >= s.min && s.registered < s.max);

  return (
    <div style={{ "--text-primary": "#1E3A5F", "--text-secondary": "#5A7B9A", "--text-dim": "#8A7F6A", "--card-bg": "rgba(255,249,236,0.85)", "--border": "rgba(180,165,130,0.22)", "--surface": "rgba(248,242,229,0.6)", minHeight: "100vh", background: "linear-gradient(160deg, #F8F2E5 0%, #FFF9EC 40%, #F8F2E5 100%)", color: "var(--text-primary)", fontFamily: "'Noto Sans TC', 'Noto Sans', -apple-system, sans-serif", padding: "0 0 100px", position: "relative", boxShadow: isAdmin ? "inset 0 0 0 3px #C85A5A, inset 0 0 40px rgba(200,90,90,0.25)" : "none" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700;900&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { height: 4px; width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(180,165,130,0.28); border-radius: 4px; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideUpModal { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        @keyframes toastIn { from { opacity: 0; transform: translateY(20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes glow { 0%, 100% { box-shadow: 0 0 12px rgba(232,155,94,0.3); } 50% { box-shadow: 0 0 24px rgba(232,155,94,0.5); } }
        @keyframes adminPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
        @keyframes ringBump { 0%, 100% { transform: scale(1); } 30% { transform: scale(1.18); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        input[type="number"]::-webkit-inner-spin-button, input[type="number"]::-webkit-outer-spin-button { opacity: 1; }
      `}</style>

      {isAdmin && (
        <div style={{ position: "sticky", top: 0, zIndex: 500, background: "linear-gradient(90deg, #C85A5A, #A84040)", color: "#fff", padding: "8px 16px", textAlign: "center", fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, boxShadow: "0 2px 12px rgba(200,90,90,0.35)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, animation: "adminPulse 2s ease infinite" }}>
            <ShieldIcon/> 管理模式中
          </span>
          <span style={{ opacity: 0.7, fontSize: 11, fontWeight: 400 }}>| 你現在擁有最高權限</span>
          <button onClick={handleAdminLogout} style={{ background: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.4)", color: "#fff", padding: "3px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", marginLeft: 8 }}>登出</button>
        </div>
      )}

      <div style={{ padding: "32px 24px 24px", background: "linear-gradient(180deg, rgba(248,242,229,0.9) 0%, transparent 100%)", borderBottom: "1px solid var(--border)", marginBottom: 20, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -40, right: -40, width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle, rgba(232,155,94,0.25), transparent 70%)", pointerEvents: "none" }}/>
        <div style={{ position: "absolute", bottom: -60, left: -30, width: 140, height: 140, borderRadius: "50%", background: "radial-gradient(circle, rgba(196,167,136,0.15), transparent 70%)", pointerEvents: "none" }}/>
        <div style={{ maxWidth: 720, margin: "0 auto", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
            <div style={{ color: "#E89B5E" }}><VolleyballIcon/></div>
            <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-0.02em", background: "linear-gradient(135deg, #E89B5E, #D4855F)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>排球揪團雷達</h1>
            <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 12, background: "rgba(232,155,94,0.18)", color: "#E89B5E", fontWeight: 700, letterSpacing: "0.1em", border: "1px solid rgba(232,155,94,0.28)" }}>TAIPEI</span>
            {/* NEW: Header auth indicator — always visible */}
            <div style={{ marginLeft: "auto" }}>
              <HeaderAuthIndicator currentUser={currentUser} onLogin={handleHeaderLogin} onLogout={handleGoogleLogout} googleLoading={googleLoading} onOpenMemberCenter={handleOpenMemberCenter}/>
            </div>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>即時掌握台北各場館的排球場次，快速找到缺人的場，讓每一場都能順利開打</p>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 16px" }}>
        <div style={{ display: "flex", marginBottom: 20, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)", background: "var(--surface)" }}>
          <button onClick={() => setActiveTab("sessions")}
            style={{ flex: 1, padding: "12px", border: "none", background: activeTab === "sessions" ? "rgba(232,155,94,0.25)" : "transparent", color: activeTab === "sessions" ? "#E89B5E" : "var(--text-secondary)", fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "all 0.2s", borderBottom: activeTab === "sessions" ? "2px solid #E89B5E" : "2px solid transparent" }}
          >🏐 場次揪團</button>
          <button onClick={() => setActiveTab("buddies")}
            style={{ flex: 1, padding: "12px", border: "none", background: activeTab === "buddies" ? "rgba(196,167,136,0.22)" : "transparent", color: activeTab === "buddies" ? "#C4A788" : "var(--text-secondary)", fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "all 0.2s", borderBottom: activeTab === "buddies" ? "2px solid #C4A788" : "2px solid transparent" }}
          >🙋 排球夥伴 <span style={{ fontSize: 11, opacity: 0.7 }}>({players.length})</span></button>
        </div>
      </div>

      {activeTab === "sessions" && <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 16px" }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 20, justifyContent: "center", flexWrap: "wrap", animation: "slideUp 0.4s ease" }}>
          <StatBadge value={allSessions.length} label="場次" color="#5A8FA8"/>
          <StatBadge value={totalPlayers} label="已報名" color="#C4A788"/>
          <StatBadge value={needPeople.length} label="缺人中" color="#E89B5E"/>
          <StatBadge value={formed.length} label="已成團" color="#7FA87C"/>
          {players.filter(p => (p.wantToPlayUntil || 0) > Date.now()).length > 0 && (
            <StatBadge value={players.filter(p => (p.wantToPlayUntil || 0) > Date.now()).length} label="想打球" color="#5B9C60"/>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14, justifyContent: "center" }}>
          {DATES.map(d => {
            const count = sessions.filter(s => s.date === d.value && !hasSessionStarted(s)).length;
            const isSelected = selectedDate === d.value;
            return (
              <button key={d.value} onClick={() => setSelectedDate(d.value)} style={{ position: "relative", padding: "8px 20px", borderRadius: 10, border: "1px solid", borderColor: isSelected ? "#E89B5E" : "var(--border)", background: isSelected ? "rgba(232,155,94,0.22)" : "transparent", color: isSelected ? "#E89B5E" : "var(--text-secondary)", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}>
                {d.label}<span style={{ fontSize: 11, opacity: 0.6, marginLeft: 4 }}>{d.value.slice(5).replace("-","/")}</span>
                {count > 0 && (
                  <span style={{ position: "absolute", top: -6, right: -6, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: isSelected ? "#E89B5E" : "#5A8FA8", color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(30,58,95,0.15)" }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", padding: "12px 16px", background: "var(--surface)", borderRadius: 14, border: "1px solid var(--border)" }}>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4, letterSpacing: "0.04em", fontWeight: 600 }}>📍 地區</label>
            <select value={selectedArea} onChange={(e) => setSelectedArea(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 8, background: "rgba(255,249,236,0.95)", border: "1px solid var(--border)", color: selectedArea !== "全部" ? "#E89B5E" : "var(--text-primary)", fontSize: 13, fontWeight: selectedArea !== "全部" ? 600 : 400, cursor: "pointer", transition: "all 0.2s" }}
              onFocus={(e) => { e.target.style.borderColor = "#E89B5E"; }}
              onBlur={(e) => { e.target.style.borderColor = "var(--border)"; }}
            >{AREAS_FILTER.map(a => <option key={a} value={a}>{a}</option>)}</select>
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4, letterSpacing: "0.04em", fontWeight: 600 }}>🏐 程度</label>
            <select value={selectedLevel} onChange={(e) => setSelectedLevel(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 8, background: "rgba(255,249,236,0.95)", border: "1px solid var(--border)", color: selectedLevel !== "全部" ? "#E89B5E" : "var(--text-primary)", fontSize: 13, fontWeight: selectedLevel !== "全部" ? 600 : 400, cursor: "pointer", transition: "all 0.2s" }}
              onFocus={(e) => { e.target.style.borderColor = "#E89B5E"; }}
              onBlur={(e) => { e.target.style.borderColor = "var(--border)"; }}
            >{LEVELS.map(l => <option key={l} value={l}>{l}</option>)}</select>
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4, letterSpacing: "0.04em", fontWeight: 600 }}>🔀 排序</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 8, background: "rgba(255,249,236,0.95)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: 13, cursor: "pointer", transition: "all 0.2s" }}
              onFocus={(e) => { e.target.style.borderColor = "#E89B5E"; }}
              onBlur={(e) => { e.target.style.borderColor = "var(--border)"; }}
            ><option value="need">缺人優先</option><option value="time">時間排序</option><option value="fee">費用低→高</option></select>
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, marginBottom: 18, justifyContent: "center", flexWrap: "wrap", fontSize: 11, color: "var(--text-dim)" }}>
          {[{color:"#C85A5A",label:"募集中"},{color:"#E89B5E",label:"即將成團（差≤3人）"},{color:"#7FA87C",label:"已成團"},{color:"#5A7B9A",label:"已滿"}].map(item => (
            <span key={item.label} style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: item.color, display: "inline-block" }}/>{item.label}</span>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {loading && (
            <div style={{ textAlign: "center", padding: 48, color: "var(--text-dim)", fontSize: 14 }}>
              <div style={{ fontSize: 36, marginBottom: 12, display: "inline-block", animation: "spin 2s linear infinite" }}>🏐</div>
              <div>載入場次中...</div>
            </div>
          )}
          {!loading && sorted.length === 0 && (
            <div style={{ textAlign: "center", padding: "48px 24px", background: "rgba(248,242,229,0.4)", borderRadius: 16, border: "1px dashed rgba(180,165,130,0.22)" }}>
              <div style={{ fontSize: 56, marginBottom: 12, opacity: 0.7 }}>🏐</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>這個時段還沒有場次</div>
              <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 20 }}>換個日期看看，或是直接揪一場吧！</div>
              <button onClick={() => setShowCreateModal(true)} style={{ padding: "10px 24px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #E89B5E, #D4855F)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 16px rgba(232,155,94,0.3)", transition: "all 0.2s" }}
                onMouseEnter={(e) => { e.target.style.transform = "translateY(-2px)"; e.target.style.boxShadow = "0 6px 20px rgba(232,155,94,0.35)"; }}
                onMouseLeave={(e) => { e.target.style.transform = "translateY(0)"; e.target.style.boxShadow = "0 4px 16px rgba(232,155,94,0.3)"; }}
              >🏐 我要開場</button>
            </div>
          )}
          {!loading && sorted.map((s, i) => (
            <div key={s.id} style={{ animation: `slideUp 0.4s ease ${i * 0.06}s both` }}>
              <SessionCard session={s} courtName={s.courtName} area={s.area} onJoin={handleJoin} onEdit={handleEditClick} onCancel={handleCancelRegistration} hasJoined={joinedSessions.has(s.id)} onAddComment={handleOpenCommentModal} onWaitlist={handleWaitlist} onCancelWaitlist={handleCancelWaitlist} hasWaitlisted={waitlistedSessions.has(s.id)} isAdmin={isAdmin} onAdminDelete={handleAdminDelete} onAdminAdjust={handleAdminAdjust}/>
            </div>
          ))}
        </div>

        {needPeople.length > 0 && (
          <div style={{ marginTop: 24, padding: "16px 20px", borderRadius: 14, background: "rgba(232,155,94,0.12)", border: "1px solid rgba(232,155,94,0.25)", fontSize: 13, color: "#E89B5E", textAlign: "center", lineHeight: 1.6 }}>
            <span style={{ animation: "pulse 2s ease infinite" }}>🔥</span>
            {" "}目前有 <strong>{needPeople.length}</strong> 個場次正在等人成團，
            總共還差 <strong>{needPeople.reduce((sum,s) => sum + Math.max(0, s.min - s.registered), 0)}</strong> 人！
          </div>
        )}
      </div>}

      {activeTab === "buddies" && <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 16px" }}>

        {/* NOTE: Old "Google login bar" has been REMOVED — auth is now in the header indicator. */}

        <div style={{ display: "flex", gap: 10, marginBottom: 20, justifyContent: "center", flexWrap: "wrap", animation: "slideUp 0.4s ease" }}>
          <StatBadge value={players.length} label="球員" color="#C4A788"/>
          <StatBadge value={players.filter(p => (p.wantToPlayUntil || 0) > Date.now()).length} label="想打球" color="#7FA87C"/>
          <StatBadge value={[...new Set(players.map(p => p.area))].length} label="活躍地區" color="#E89B5E"/>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", padding: "12px 16px", background: "var(--surface)", borderRadius: 14, border: "1px solid var(--border)" }}>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4, letterSpacing: "0.04em", fontWeight: 600 }}>📍 地區</label>
            <select value={playerFilterArea} onChange={(e) => setPlayerFilterArea(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 8, background: "rgba(255,249,236,0.95)", border: "1px solid var(--border)", color: playerFilterArea !== "全部" ? "#C4A788" : "var(--text-primary)", fontSize: 13, fontWeight: playerFilterArea !== "全部" ? 600 : 400, cursor: "pointer" }}
            ><option value="全部">全部</option>{[...new Set(players.map(p => p.area).filter(Boolean))].map(a => <option key={a} value={a}>{a}</option>)}</select>
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4, letterSpacing: "0.04em", fontWeight: 600 }}>🏐 程度</label>
            <select value={playerFilterLevel} onChange={(e) => setPlayerFilterLevel(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 8, background: "rgba(255,249,236,0.95)", border: "1px solid var(--border)", color: playerFilterLevel !== "全部" ? "#C4A788" : "var(--text-primary)", fontSize: 13, fontWeight: playerFilterLevel !== "全部" ? 600 : 400, cursor: "pointer" }}
            ><option value="全部">全部</option>{LEVELS_INPUT.map(l => <option key={l} value={l}>{l}</option>)}</select>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {players
            .filter(p => playerFilterArea === "全部" || p.area === playerFilterArea)
            .filter(p => playerFilterLevel === "全部" || p.level === playerFilterLevel)
            .sort((a, b) => {
              const aWant = (a.wantToPlayUntil || 0) > Date.now() ? 1 : 0;
              const bWant = (b.wantToPlayUntil || 0) > Date.now() ? 1 : 0;
              return bWant - aWant;
            })
            .map((p, i) => (
            <div key={p.id} style={{ animation: `slideUp 0.4s ease ${i * 0.06}s both` }}>
              <PlayerCard player={p} onEdit={handleEditPlayerClick} onWantToPlay={handleWantToPlay} onRecord={handleOpenRecordModal} currentUser={currentUser} onShare={handleOpenShareCard}/>
            </div>
          ))}
          {players.filter(p => playerFilterArea === "全部" || p.area === playerFilterArea).filter(p => playerFilterLevel === "全部" || p.level === playerFilterLevel).length === 0 && (
            <div style={{ textAlign: "center", padding: "48px 24px", background: "rgba(248,242,229,0.4)", borderRadius: 16, border: "1px dashed rgba(180,165,130,0.22)" }}>
              <div style={{ fontSize: 56, marginBottom: 12, opacity: 0.7 }}>🙋</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>還沒有球員資料</div>
              <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 20 }}>成為第一個註冊的球員吧！</div>
              <button onClick={handleOpenRegisterFlow} style={{ padding: "10px 24px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #C4A788, #A88B6B)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>🙋 我要註冊</button>
            </div>
          )}
        </div>
      </div>}

      {activeTab === "sessions" ? (
        <button onClick={() => setShowCreateModal(true)}
          title="我要開場"
          style={{ position: "fixed", bottom: 24, right: 24, zIndex: 800, height: 60, padding: "0 22px", borderRadius: 30, border: "none", background: "linear-gradient(135deg, #E89B5E, #D4855F)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 24px rgba(232,155,94,0.4)", transition: "all 0.25s ease", animation: "glow 3s ease infinite", fontSize: 14, fontWeight: 700 }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = "0 6px 28px rgba(232,155,94,0.55)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 4px 24px rgba(232,155,94,0.4)"; }}
        ><PlusIcon/><span>我要開場</span></button>
      ) : (
        <button onClick={handleOpenRegisterFlow}
          title="我要註冊"
          style={{ position: "fixed", bottom: 24, right: 24, zIndex: 800, height: 60, padding: "0 22px", borderRadius: 30, border: "none", background: "linear-gradient(135deg, #C4A788, #A88B6B)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 24px rgba(196,167,136,0.4)", transition: "all 0.25s ease", animation: "glow 3s ease infinite", fontSize: 14, fontWeight: 700 }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = "0 6px 28px rgba(196,167,136,0.55)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 4px 24px rgba(196,167,136,0.4)"; }}
        ><PlusIcon/><span>我要註冊</span></button>
      )}

      <CreateSessionModal open={showCreateModal} onClose={() => setShowCreateModal(false)} onSubmit={handleCreateSession}/>

      <PasswordModal open={showPasswordModal} onClose={() => { setShowPasswordModal(false); setEditTarget(null); }} onVerify={handlePasswordVerify} sessionId={editTarget?.session?.id}/>

      <EditSessionModal open={showEditModal} onClose={() => { setShowEditModal(false); setEditTarget(null); }} session={editTarget?.session} courtName={editTarget?.courtName} area={editTarget?.area} onSave={handleSaveEdit} onCloseSession={handleCloseSession} onShare={handleOpenShareModal} onNotify={handleOpenNotifyModal}/>

      <CommentModal open={showCommentModal} onClose={() => { setShowCommentModal(false); setCommentTarget(null); }} session={commentTarget} onSubmit={handleAddComment}/>

      <AdminLoginModal open={showAdminLoginModal} onClose={() => setShowAdminLoginModal(false)} onLogin={handleAdminLogin}/>

      <ShareModal open={showShareModal} onClose={() => { setShowShareModal(false); setShareData(null); }} data={shareData} wantToPlayCount={players.filter(p => (p.wantToPlayUntil || 0) > Date.now()).length} onNotifyWantToPlay={async (sessionData) => {
        const matchSession = sessions.find(s => s.courtName === sessionData.courtName && s.date === sessionData.date && s.time === sessionData.time && s.host === sessionData.host);
        if (!matchSession) return { error: "找不到場次資料，請稍後重試" };
        return handleSendLineNotification(matchSession.id, "wantToPlay", "", sessionData.password || matchSession.password);
      }}/>

      <NotifyModal open={showNotifyModal} onClose={() => { setShowNotifyModal(false); setNotifyTarget(null); }} session={notifyTarget} onSend={handleSendLineNotification}/>

      <BindingCodeModal open={showBindingModal} onClose={() => { setShowBindingModal(false); setBindingCode(null); }} code={bindingCode}/>

      {/* MODIFIED: pass currentUser to CreatePlayerModal */}
      <CreatePlayerModal open={showCreatePlayerModal} onClose={() => setShowCreatePlayerModal(false)} onSubmit={handleCreatePlayer} currentUser={currentUser}/>

      {/* NEW: LoginChoiceModal */}
      <LoginChoiceModal open={showLoginChoiceModal} onClose={() => setShowLoginChoiceModal(false)} onGoogle={handleChooseGoogle} onGuest={handleChooseGuest} googleLoading={googleLoading}/>

      <PasswordModal open={showPlayerPasswordModal} onClose={() => { setShowPlayerPasswordModal(false); setEditPlayerTarget(null); }} onVerify={handlePlayerPasswordVerify} sessionId={editPlayerTarget?.id}/>
      <EditPlayerModal open={showEditPlayerModal} onClose={() => { setShowEditPlayerModal(false); setEditPlayerTarget(null); }} player={editPlayerTarget} onSave={handleSavePlayer} onDelete={handleDeletePlayer}/>
      <WeeklyRecordModal open={showRecordModal} onClose={() => { setShowRecordModal(false); setRecordTarget(null); }} player={recordTarget} onSave={handleSaveWeeklyRecord}/>

      {/* NEW: ShareCardModal */}
      <ShareCardModal open={showShareCardModal} onClose={() => { setShowShareCardModal(false); setShareCardTarget(null); }} player={shareCardTarget}/>

      {/* NEW: MemberCenterModal — the member dashboard */}
      <MemberCenterModal
        open={showMemberCenterModal}
        onClose={() => setShowMemberCenterModal(false)}
        currentUser={currentUser}
        players={players}
        onEditProfile={(player) => { setShowMemberCenterModal(false); handleEditPlayerClick(player); }}
        onOpenRegisterFlow={handleOpenRegisterFlow}
        onWantToPlay={handleWantToPlay}
        onRecord={(player) => { setShowMemberCenterModal(false); handleOpenRecordModal(player); }}
        onShare={(player) => { setShowMemberCenterModal(false); handleOpenShareCard(player); }}
        onDelete={(playerId) => { setShowMemberCenterModal(false); handleDeletePlayer(playerId); }}
        onMergeDuplicates={handleMergeDuplicates}
        onEditRecord={(player, record) => { setShowMemberCenterModal(false); handleEditHistoricalRecord(player, record); }}
      />

      {showToast && (
        <div style={{ position: "fixed", bottom: 96, left: "50%", transform: "translateX(-50%)", padding: "14px 24px", borderRadius: 14, background: showToast.type === "warn" ? "rgba(232,155,94,0.95)" : "rgba(127,168,124,0.95)", color: "#fff", fontSize: 13, fontWeight: 700, zIndex: 999, animation: "toastIn 0.3s ease", boxShadow: showToast.type === "warn" ? "0 8px 32px rgba(232,155,94,0.4)" : "0 8px 32px rgba(127,168,124,0.4)", maxWidth: "90vw", textAlign: "center", lineHeight: 1.5, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>{showToast.type === "warn" ? "⚠️" : "✅"}</span>
          <span>{showToast.msg}</span>
        </div>
      )}
    </div>
  );
}
