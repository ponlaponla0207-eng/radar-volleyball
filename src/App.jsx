import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, updateDoc, doc, onSnapshot, query, orderBy, serverTimestamp, increment, deleteDoc, arrayUnion } from "firebase/firestore";

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
  if (registered >= max) return { label: "已滿", color: "#94a3b8", bg: "rgba(148,163,184,0.12)" };
  if (registered >= min) return { label: "已成團", color: "#22c55e", bg: "rgba(34,197,94,0.10)" };
  if (registered >= min - 3) return { label: "即將成團", color: "#f59e0b", bg: "rgba(245,158,11,0.10)" };
  return { label: "募集中", color: "#ef4444", bg: "rgba(239,68,68,0.08)" };
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
const inputStyle = { width: "100%", padding: "10px 14px", borderRadius: 10, background: "rgba(15,23,42,0.8)", border: "1px solid rgba(148,163,184,0.15)", color: "#e2e8f0", fontSize: 14, outline: "none", transition: "border-color 0.2s", fontFamily: "inherit" };
const labelStyle = { fontSize: 12, color: "#94a3b8", marginBottom: 6, display: "block", fontWeight: 600, letterSpacing: "0.04em" };

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
        <circle stroke="rgba(148,163,184,0.15)" fill="transparent" strokeWidth={stroke} r={nr} cx={radius} cy={radius}/>
        <circle stroke="rgba(148,163,184,0.25)" fill="transparent" strokeWidth={stroke} strokeDasharray={`2 ${circ-2}`} strokeDashoffset={-minOffset+1} r={nr} cx={radius} cy={radius} strokeLinecap="butt"/>
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
      <button onClick={() => onEdit(session)} title="主揪編輯" style={{ position: "absolute", top: 10, right: 12, background: "rgba(148,163,184,0.08)", border: "1px solid rgba(148,163,184,0.12)", borderRadius: 8, padding: "5px 8px", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", gap: 4, fontSize: 11, transition: "all 0.2s" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(245,158,11,0.12)"; e.currentTarget.style.color = "#f59e0b"; e.currentTarget.style.borderColor = "rgba(245,158,11,0.25)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(148,163,184,0.08)"; e.currentTarget.style.color = "#64748b"; e.currentTarget.style.borderColor = "rgba(148,163,184,0.12)"; }}
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
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "rgba(96,165,250,0.12)", color: "#60a5fa", fontWeight: 600 }}>✓ 你已報名</span>
            )}
            {hasWaitlisted && (
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "rgba(168,85,247,0.12)", color: "#a855f7", fontWeight: 600 }}>🕐 你在候補中</span>
            )}
            {session.closed && (
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "rgba(239,68,68,0.12)", color: "#ef4444", fontWeight: 600 }}>🚫 已關閉</span>
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
          {hasValidUrl && !hasJoined && !hasWaitlisted && <div style={{ fontSize: 11, marginBottom: 8, color: "#64748b", display: "flex", alignItems: "center", gap: 4 }}>🔗 點擊報名按鈕將前往外部報名頁面</div>}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            {!isFormed && !isFull && <span style={{ fontSize: 13, color: status.color, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}><PersonIcon/> 還差 {need} 人成團</span>}
            {isFormed && !isFull && <span style={{ fontSize: 13, color: "#22c55e", fontWeight: 500 }}>✅ 已成團，還可加入 {session.max - session.registered} 人</span>}
            {isFull && (
              <span style={{ fontSize: 13, color: "#94a3b8" }}>
                已額滿{waitlist > 0 && <span style={{ color: "#a855f7", marginLeft: 6 }}>· 候補 {waitlist} 人</span>}
              </span>
            )}
            {hasJoined ? (
              <button onClick={() => onCancel(session.id)}
                style={{ padding: "7px 18px", borderRadius: 10, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#ef4444", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.2s ease" }}
                onMouseEnter={(e) => { e.target.style.background = "rgba(239,68,68,0.15)"; }}
                onMouseLeave={(e) => { e.target.style.background = "rgba(239,68,68,0.08)"; }}
              >✕ 取消報名</button>
            ) : hasWaitlisted ? (
              <button onClick={() => onCancelWaitlist(session.id)}
                style={{ padding: "7px 18px", borderRadius: 10, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#ef4444", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.2s ease" }}
                onMouseEnter={(e) => { e.target.style.background = "rgba(239,68,68,0.15)"; }}
                onMouseLeave={(e) => { e.target.style.background = "rgba(239,68,68,0.08)"; }}
              >✕ 取消候補</button>
            ) : isFull ? (
              <button onClick={() => { if (hasValidUrl) { window.open(session.signupUrl, "_blank", "noopener,noreferrer"); } onWaitlist(session.id); }}
                style={{ padding: "7px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #a855f7, #8b5cf6)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.2s ease" }}
                onMouseEnter={(e) => { e.target.style.transform = "scale(1.04)"; }}
                onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; }}
              >🕐 我要候補{hasValidUrl ? " ↗" : ""}</button>
            ) : (
              <button onClick={() => { if (hasValidUrl) { window.open(session.signupUrl, "_blank", "noopener,noreferrer"); } onJoin(session.id); }}
                style={{ padding: "7px 20px", borderRadius: 10, border: "none", background: isFormed ? "rgba(34,197,94,0.12)" : `linear-gradient(135deg, ${status.color}, ${status.color}dd)`, color: isFormed ? "#22c55e" : "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.2s ease" }}
                onMouseEnter={(e) => { e.target.style.transform = "scale(1.04)"; }}
                onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; }}
              >{isFormed ? "+ 我要加入" : "🙋 我要報名"}{hasValidUrl ? " ↗" : ""}</button>
            )}
          </div>

          {/* Admin controls (red bar) */}
          {isAdmin && (
            <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
              <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
                <ShieldIcon/> 管理者控制
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#94a3b8" }}>
                  <span>報名：</span>
                  <button onClick={() => onAdminAdjust(session.id, "registered", -1)}
                    style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(148,163,184,0.2)", background: "rgba(15,23,42,0.8)", color: "#e2e8f0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.2)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.4)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(15,23,42,0.8)"; e.currentTarget.style.borderColor = "rgba(148,163,184,0.2)"; }}
                  ><MinusIcon/></button>
                  <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, color: "#e2e8f0", minWidth: 20, textAlign: "center" }}>{session.registered}</span>
                  <button onClick={() => onAdminAdjust(session.id, "registered", 1)}
                    style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(148,163,184,0.2)", background: "rgba(15,23,42,0.8)", color: "#e2e8f0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(34,197,94,0.2)"; e.currentTarget.style.borderColor = "rgba(34,197,94,0.4)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(15,23,42,0.8)"; e.currentTarget.style.borderColor = "rgba(148,163,184,0.2)"; }}
                  ><PlusSmallIcon/></button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#94a3b8" }}>
                  <span>候補：</span>
                  <button onClick={() => onAdminAdjust(session.id, "waitlist", -1)}
                    style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(148,163,184,0.2)", background: "rgba(15,23,42,0.8)", color: "#e2e8f0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.2)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.4)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(15,23,42,0.8)"; e.currentTarget.style.borderColor = "rgba(148,163,184,0.2)"; }}
                  ><MinusIcon/></button>
                  <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, color: "#e2e8f0", minWidth: 20, textAlign: "center" }}>{session.waitlist || 0}</span>
                  <button onClick={() => onAdminAdjust(session.id, "waitlist", 1)}
                    style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(148,163,184,0.2)", background: "rgba(15,23,42,0.8)", color: "#e2e8f0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(34,197,94,0.2)"; e.currentTarget.style.borderColor = "rgba(34,197,94,0.4)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(15,23,42,0.8)"; e.currentTarget.style.borderColor = "rgba(148,163,184,0.2)"; }}
                  ><PlusSmallIcon/></button>
                </div>
                <button onClick={() => onAdminDelete(session)}
                  style={{ marginLeft: "auto", padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.1)", color: "#ef4444", fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, transition: "all 0.2s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
                >
                  <TrashIcon/> 刪除場次
                </button>
              </div>
            </div>
          )}

          {/* Comments section */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed rgba(148,163,184,0.15)" }}>
            <button onClick={() => setCommentsOpen(o => !o)}
              style={{ background: commentCount > 0 ? "rgba(96,165,250,0.05)" : "transparent", border: "none", padding: "6px 10px", borderRadius: 8, cursor: "pointer", color: commentCount > 0 ? "#60a5fa" : "#64748b", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, width: "100%", justifyContent: "space-between", transition: "all 0.2s" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = commentCount > 0 ? "rgba(96,165,250,0.1)" : "rgba(148,163,184,0.06)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = commentCount > 0 ? "rgba(96,165,250,0.05)" : "transparent"; }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <ChatIcon/>
                {commentCount > 0 ? (
                  <>主揪留言 <span style={{ color: "#60a5fa", fontWeight: 700 }}>({commentCount})</span></>
                ) : (
                  <span style={{ color: "#64748b" }}>尚無主揪留言</span>
                )}
              </span>
              <ChevronIcon open={commentsOpen}/>
            </button>

            {commentsOpen && (
              <div style={{ marginTop: 10, animation: "fadeIn 0.2s ease" }}>
                {sortedComments.length === 0 && (
                  <div style={{ fontSize: 12, color: "#64748b", padding: "8px 0", textAlign: "center", fontStyle: "italic" }}>
                    還沒有任何主揪留言
                  </div>
                )}
                {sortedComments.map((c, idx) => (
                  <div key={idx} style={{ padding: "10px 12px", marginBottom: 6, borderRadius: 10, background: "rgba(96,165,250,0.04)", border: "1px solid rgba(96,165,250,0.1)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, fontSize: 11, color: "#64748b" }}>
                      <span style={{ fontWeight: 600, color: "#60a5fa" }}>👤 {c.author || session.host}</span>
                      <span>{formatRelativeTime(c.createdAt)}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{c.text}</div>
                  </div>
                ))}
                <button onClick={() => onAddComment(session)}
                  style={{ width: "100%", marginTop: 6, padding: "8px", borderRadius: 10, border: "1px dashed rgba(96,165,250,0.3)", background: "rgba(96,165,250,0.04)", color: "#60a5fa", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={(e) => { e.target.style.background = "rgba(96,165,250,0.1)"; }}
                  onMouseLeave={(e) => { e.target.style.background = "rgba(96,165,250,0.04)"; }}
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
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 901, width: "min(380px, 90vw)", background: "linear-gradient(180deg, #1a1f35, #0f172a)", borderRadius: 20, border: "1px solid rgba(148,163,184,0.12)", padding: "28px 24px", animation: "fadeIn 0.25s ease", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <LockIcon/>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: "#e2e8f0" }}>主揪驗證</h3>
        </div>
        <p style={{ fontSize: 13, color: "#64748b", marginBottom: 16, lineHeight: 1.5 }}>請輸入開場時設定的密碼才能編輯此場次</p>
        <input ref={inputRef} type="password" value={pw} onChange={(e) => { setPw(e.target.value); setError(""); }}
          placeholder="輸入密碼"
          style={{ ...inputStyle, borderColor: error ? "#ef4444" : "rgba(148,163,184,0.15)", marginBottom: error ? 4 : 16 }}
          onFocus={(e) => { e.target.style.borderColor = "#f59e0b"; }}
          onBlur={(e) => { e.target.style.borderColor = error ? "#ef4444" : "rgba(148,163,184,0.15)"; }}
          onKeyDown={(e) => { if (e.key === "Enter") { const ok = onVerify(sessionId, pw); if (!ok) setError("密碼錯誤，請重新輸入"); } }}
        />
        {error && <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(148,163,184,0.2)", background: "transparent", color: "#94a3b8", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>取消</button>
          <button onClick={() => { const ok = onVerify(sessionId, pw); if (!ok) setError("密碼錯誤，請重新輸入"); }}
            style={{ flex: 1, padding: "12px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #f59e0b, #f97316)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
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
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 901, width: "min(420px, 92vw)", background: "linear-gradient(180deg, #1a1f35, #0f172a)", borderRadius: 20, border: "1px solid rgba(148,163,184,0.12)", padding: "28px 24px", animation: "fadeIn 0.25s ease", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <ChatIcon/>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: "#e2e8f0" }}>主揪留言</h3>
        </div>
        <p style={{ fontSize: 12, color: "#64748b", marginBottom: 16, lineHeight: 1.5 }}>
          {verified ? `以「${session.host}」的身份發佈留言` : "請先輸入密碼驗證主揪身份"}
        </p>

        {!verified ? (
          <>
            <input ref={pwRef} type="password" value={pw} onChange={(e) => { setPw(e.target.value); setError(""); }}
              placeholder="輸入密碼"
              style={{ ...inputStyle, borderColor: error ? "#ef4444" : "rgba(148,163,184,0.15)", marginBottom: error ? 4 : 16 }}
              onFocus={(e) => { e.target.style.borderColor = "#f59e0b"; }}
              onBlur={(e) => { e.target.style.borderColor = error ? "#ef4444" : "rgba(148,163,184,0.15)"; }}
              onKeyDown={(e) => { if (e.key === "Enter") tryVerify(); }}
            />
            {error && <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 12 }}>{error}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(148,163,184,0.2)", background: "transparent", color: "#94a3b8", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>取消</button>
              <button onClick={tryVerify}
                style={{ flex: 1, padding: "12px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #f59e0b, #f97316)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
              >驗證</button>
            </div>
          </>
        ) : (
          <>
            <textarea ref={textRef} value={text} onChange={(e) => { setText(e.target.value); setError(""); }}
              placeholder="例如：已湊到 10 人，再 2 人就可以打了！或：因下雨延到明天同時段，請大家注意..."
              rows={4}
              style={{ ...inputStyle, resize: "vertical", minHeight: 100, borderColor: error ? "#ef4444" : "rgba(148,163,184,0.15)", marginBottom: error ? 4 : 10 }}
              onFocus={(e) => { e.target.style.borderColor = "#f59e0b"; }}
              onBlur={(e) => { e.target.style.borderColor = error ? "#ef4444" : "rgba(148,163,184,0.15)"; }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginBottom: 14 }}>
              <span>{error && <span style={{ color: "#ef4444" }}>{error}</span>}</span>
              <span style={{ color: text.length > 500 ? "#ef4444" : "#64748b" }}>{text.length} / 500</span>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(148,163,184,0.2)", background: "transparent", color: "#94a3b8", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>取消</button>
              <button onClick={handleSubmit}
                style={{ flex: 2, padding: "12px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #60a5fa, #3b82f6)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={(e) => { e.target.style.transform = "scale(1.02)"; e.target.style.boxShadow = "0 4px 20px rgba(96,165,250,0.3)"; }}
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
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 901, width: "min(380px, 90vw)", background: "linear-gradient(180deg, #2a1515, #1a0a0a)", borderRadius: 20, border: "1px solid rgba(239,68,68,0.3)", padding: "28px 24px", animation: "fadeIn 0.25s ease", boxShadow: "0 20px 60px rgba(239,68,68,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, color: "#ef4444" }}>
          <ShieldIcon/>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: "#ef4444" }}>管理者登入</h3>
        </div>
        <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16, lineHeight: 1.5 }}>
          此為高權限模式，可刪除、編輯任何場次。請輸入管理者密碼。
        </p>
        <input ref={inputRef} type="password" value={pw} onChange={(e) => { setPw(e.target.value); setError(""); }}
          placeholder="管理者密碼"
          style={{ ...inputStyle, borderColor: error ? "#ef4444" : "rgba(239,68,68,0.3)", marginBottom: error ? 4 : 16 }}
          onFocus={(e) => { e.target.style.borderColor = "#ef4444"; }}
          onBlur={(e) => { e.target.style.borderColor = error ? "#ef4444" : "rgba(239,68,68,0.3)"; }}
          onKeyDown={(e) => { if (e.key === "Enter") tryLogin(); }}
        />
        {error && <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(148,163,184,0.2)", background: "transparent", color: "#94a3b8", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>取消</button>
          <button onClick={tryLogin}
            style={{ flex: 1, padding: "12px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #ef4444, #dc2626)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
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
const ShareModal = ({ open, onClose, data }) => {
  const [copied, setCopied] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [text, setText] = useState("");

  useEffect(() => {
    if (open && data) {
      setText(generatePostText(data));
      setCopied(false);
      setSelectedGroup("");
      setCustomUrl("");
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
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 901, width: "min(520px, 94vw)", maxHeight: "92vh", overflowY: "auto", background: "linear-gradient(180deg, #1a1f35, #0f172a)", borderRadius: 20, border: "1px solid rgba(96,165,250,0.2)", padding: "28px 24px", animation: "fadeIn 0.25s ease", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>🎉</span>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: "#e2e8f0" }}>場次已發佈！</h3>
        </div>
        <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 18, lineHeight: 1.5 }}>
          幫你準備好了揪團文字，複製後可直接貼到 FB 社團發文。
        </p>

        {/* Text preview */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 6, fontWeight: 600, letterSpacing: "0.04em" }}>📝 揪團文字預覽（可編輯）</div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={14}
            style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "rgba(15,23,42,0.8)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", fontSize: 13, lineHeight: 1.7, fontFamily: "'Noto Sans TC', monospace", resize: "vertical", minHeight: 200, outline: "none", boxSizing: "border-box" }}
            onFocus={(e) => { e.target.style.borderColor = "#60a5fa"; }}
            onBlur={(e) => { e.target.style.borderColor = "rgba(148,163,184,0.2)"; }}
          />
        </div>

        {/* Copy button */}
        <button onClick={handleCopy}
          style={{ width: "100%", padding: "12px", borderRadius: 12, border: "none", background: copied ? "linear-gradient(135deg, #22c55e, #16a34a)" : "linear-gradient(135deg, #60a5fa, #3b82f6)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 18, transition: "all 0.2s" }}
          onMouseEnter={(e) => { if (!copied) e.target.style.transform = "scale(1.02)"; }}
          onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; }}
        >
          {copied ? <><CheckIcon/> 已複製到剪貼簿！</> : <><CopyIcon/> 複製文字</>}
        </button>

        {/* FB group selector */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 6, fontWeight: 600, letterSpacing: "0.04em" }}>📢 選擇要發佈的 FB 社團</div>
          <select value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 10, background: "rgba(15,23,42,0.8)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", fontSize: 13, cursor: "pointer", outline: "none" }}
          >
            <option value="">-- 請選擇社團 --</option>
            {FB_GROUPS.map(g => <option key={g.url} value={g.url}>{g.name}</option>)}
            <option value="custom">📌 自訂連結</option>
          </select>

          {selectedGroup === "custom" && (
            <input type="text" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="貼上 FB 社團網址..."
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, background: "rgba(15,23,42,0.8)", border: "1px solid", borderColor: customUrl && !isValidUrl(customUrl) ? "#ef4444" : "rgba(148,163,184,0.2)", color: "#e2e8f0", fontSize: 13, marginTop: 8, outline: "none", boxSizing: "border-box" }}
              onFocus={(e) => { if (!customUrl || isValidUrl(customUrl)) e.target.style.borderColor = "#60a5fa"; }}
              onBlur={(e) => { e.target.style.borderColor = customUrl && !isValidUrl(customUrl) ? "#ef4444" : "rgba(148,163,184,0.2)"; }}
            />
          )}
          {selectedGroup === "custom" && customUrl && !isValidUrl(customUrl) && (
            <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>⚠️ 請輸入有效的網址（http:// 或 https:// 開頭）</div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(148,163,184,0.2)", background: "transparent", color: "#94a3b8", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>稍後再說</button>
          <button onClick={handleOpenFb} disabled={!canOpen}
            style={{ flex: 2, padding: "12px", borderRadius: 12, border: "none", background: canOpen ? "linear-gradient(135deg, #1877f2, #0e5fc9)" : "rgba(148,163,184,0.1)", color: canOpen ? "#fff" : "#64748b", fontSize: 14, fontWeight: 700, cursor: canOpen ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.2s" }}
            onMouseEnter={(e) => { if (canOpen) e.target.style.transform = "scale(1.02)"; }}
            onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; }}
          >🔗 前往 FB 社團貼文</button>
        </div>

        <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", fontSize: 11, color: "#f59e0b", lineHeight: 1.5 }}>
          💡 <strong>小提示：</strong>按「複製文字」→ 再按「前往 FB 社團貼文」→ 在 FB 社團點發文並貼上即可。
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
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 901, width: "min(480px, 94vw)", maxHeight: "92vh", overflowY: "auto", background: "linear-gradient(180deg, #1a1f35, #0f172a)", borderRadius: 20, border: "1px solid rgba(6,199,85,0.25)", padding: "28px 24px", animation: "fadeIn 0.25s ease", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <BellIcon/>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: "#e2e8f0" }}>LINE 通知</h3>
        </div>
        <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16, lineHeight: 1.5 }}>
          發送 LINE 訊息給此場次已綁定的報名者
          <span style={{ display: "block", marginTop: 6, color: (2 - (session.notifyCount || 0)) <= 0 ? "#ef4444" : "#f59e0b", fontWeight: 600 }}>
            📢 剩餘通知次數：{Math.max(0, 2 - (session.notifyCount || 0))} / 2
          </span>
        </p>

        {/* Notify type selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {types.map(t => (
            <label key={t.value} onClick={() => setNotifyType(t.value)}
              style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid", borderColor: notifyType === t.value ? "#06c755" : "rgba(148,163,184,0.15)", background: notifyType === t.value ? "rgba(6,199,85,0.08)" : "transparent", cursor: "pointer", transition: "all 0.2s" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: notifyType === t.value ? "#06c755" : "#e2e8f0", marginBottom: 2 }}>{t.label}</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>{t.desc}</div>
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
              style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "rgba(15,23,42,0.8)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", fontSize: 13, lineHeight: 1.6, resize: "vertical", minHeight: 80, outline: "none", boxSizing: "border-box", fontFamily: "'Noto Sans TC', sans-serif" }}
              onFocus={(e) => { e.target.style.borderColor = "#06c755"; }}
              onBlur={(e) => { e.target.style.borderColor = "rgba(148,163,184,0.2)"; }}
            />
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, textAlign: "right" }}>{customMessage.length} / 500</div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div style={{ marginBottom: 14, padding: "12px", borderRadius: 10, background: result.error ? "rgba(239,68,68,0.08)" : "rgba(6,199,85,0.08)", border: `1px solid ${result.error ? "rgba(239,68,68,0.3)" : "rgba(6,199,85,0.3)"}`, fontSize: 13, color: result.error ? "#ef4444" : "#06c755", fontWeight: 600 }}>
            {result.error
              ? `❌ 發送失敗：${result.error}`
              : `✅ ${result.message}`}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(148,163,184,0.2)", background: "transparent", color: "#94a3b8", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>取消</button>
          <button onClick={handleSend} disabled={sending || (isCustom && !customMessage.trim()) || (2 - (session.notifyCount || 0)) <= 0}
            style={{ flex: 2, padding: "12px", borderRadius: 12, border: "none", background: (sending || (2 - (session.notifyCount || 0)) <= 0) ? "rgba(148,163,184,0.15)" : "linear-gradient(135deg, #06c755, #05a847)", color: (sending || (2 - (session.notifyCount || 0)) <= 0) ? "#64748b" : "#fff", fontSize: 14, fontWeight: 700, cursor: (sending || (2 - (session.notifyCount || 0)) <= 0) ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.2s" }}
          >
            {(2 - (session.notifyCount || 0)) <= 0 ? "已達通知上限" : sending ? "發送中..." : "📣 發送通知"}
          </button>
        </div>

        <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.15)", fontSize: 11, color: "#64748b", lineHeight: 1.6 }}>
          💡 通知只會發送給此場次有綁定 LINE 的報名者（目前 <strong style={{ color: "#06c755" }}>{(session.lineUserIds || []).length}</strong> 人已綁定）。報名者需要在報名後輸入綁定碼才能收到通知。
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
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 901, width: "min(400px, 92vw)", background: "linear-gradient(180deg, #1a1f35, #0f172a)", borderRadius: 20, border: "1px solid rgba(6,199,85,0.25)", padding: "28px 24px", animation: "fadeIn 0.25s ease", boxShadow: "0 20px 60px rgba(0,0,0,0.5)", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
        <h3 style={{ fontSize: 18, fontWeight: 800, color: "#e2e8f0", marginBottom: 6 }}>報名成功！</h3>
        <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 20, lineHeight: 1.6 }}>
          請記得到主揪的報名頁面 +1，待主揪確認後才算報名成功。<br/>
          如果想收到 LINE 通知（成團、改期等），請完成以下綁定：
        </p>

        {/* Step 1 */}
        <div style={{ textAlign: "left", marginBottom: 16, padding: "14px 16px", borderRadius: 12, background: "rgba(6,199,85,0.06)", border: "1px solid rgba(6,199,85,0.2)" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#06c755", marginBottom: 8 }}>Step 1：加 LINE 官方帳號好友</div>
          <a href={LINE_OA_URL} target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: "#06c755", color: "#fff", fontSize: 13, fontWeight: 700, textDecoration: "none" }}
          >加入好友 →</a>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>如果已經加過好友可跳過此步驟</div>
        </div>

        {/* Step 2 */}
        <div style={{ textAlign: "left", marginBottom: 20, padding: "14px 16px", borderRadius: 12, background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.2)" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#60a5fa", marginBottom: 10 }}>Step 2：在 LINE 聊天室輸入以下綁定碼</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: 32, fontWeight: 900, letterSpacing: "0.2em", fontFamily: "'Space Mono', monospace", color: "#e2e8f0", background: "rgba(15,23,42,0.8)", padding: "8px 20px", borderRadius: 10, border: "1px solid rgba(148,163,184,0.2)" }}>{code}</span>
            <button onClick={handleCopy}
              style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: copied ? "#22c55e" : "#60a5fa", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
            >{copied ? "✓ 已複製" : "複製"}</button>
          </div>
          <div style={{ fontSize: 11, color: "#64748b" }}>綁定碼有效期限 24 小時</div>
        </div>

        <button onClick={onClose}
          style={{ width: "100%", padding: "14px", borderRadius: 14, border: "none", background: "linear-gradient(135deg, #f59e0b, #f97316)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
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
        <textarea value={form[field] || ""} onChange={(e) => setForm({...form, [field]: e.target.value})} placeholder={placeholder} rows={2} style={{...inputStyle, resize: "vertical", minHeight: 56, borderColor: err ? "#ef4444" : "rgba(148,163,184,0.15)"}} onFocus={(e)=>{e.target.style.borderColor="#f59e0b";}} onBlur={(e)=>{e.target.style.borderColor=err?"#ef4444":"rgba(148,163,184,0.15)";}}/>
      ) : (
        <input type={type||"text"} min={min} max={max} step={step} value={form[field]||""} onChange={(e) => setForm({...form, [field]: e.target.value})} placeholder={placeholder}
          style={{...inputStyle, borderColor: err ? "#ef4444" : "rgba(148,163,184,0.15)"}}
          onFocus={(e)=>{e.target.style.borderColor="#f59e0b";}} onBlur={(e)=>{e.target.style.borderColor=err?"#ef4444":"rgba(148,163,184,0.15)";}}
        />
      )}
      {err && <span style={{ fontSize: 11, color: "#ef4444", marginTop: 4, display: "block" }}>{err}</span>}
    </div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 901, maxHeight: "92vh", overflowY: "auto", background: "linear-gradient(180deg, #1a1f35, #0f172a)", borderRadius: "24px 24px 0 0", border: "1px solid rgba(148,163,184,0.12)", borderBottom: "none", animation: "slideUpModal 0.35s cubic-bezier(0.16,1,0.3,1)", boxShadow: "0 -10px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}><div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(148,163,184,0.25)" }}/></div>
        <div style={{ padding: "8px 24px 32px", maxWidth: 520, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#f59e0b" }}>✏️ 編輯場次</h2>
            <button onClick={onClose} style={{ background: "rgba(148,163,184,0.1)", border: "none", borderRadius: 10, padding: 8, cursor: "pointer", color: "#94a3b8", display: "flex" }}><CloseIcon/></button>
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
              <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", fontSize: 13, color: "#f59e0b" }}>
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
                  borderColor: form.signupUrl && !isValidUrl(form.signupUrl) ? "#ef4444" : (form.signupUrl && isValidUrl(form.signupUrl) ? "#22c55e" : "rgba(148,163,184,0.15)")
                }}
                onFocus={(e)=>{ if (!form.signupUrl) e.target.style.borderColor = "#f59e0b"; }}
                onBlur={(e)=>{ e.target.style.borderColor = form.signupUrl && !isValidUrl(form.signupUrl) ? "#ef4444" : (form.signupUrl && isValidUrl(form.signupUrl) ? "#22c55e" : "rgba(148,163,184,0.15)"); }}
              />
              {form.signupUrl && !isValidUrl(form.signupUrl) ? (
                <span style={{ fontSize: 11, color: "#ef4444", marginTop: 4, display: "block" }}>⚠️ 這不是有效的網址，請以 http:// 或 https:// 開頭（留空也 OK）</span>
              ) : form.signupUrl && isValidUrl(form.signupUrl) ? (
                <span style={{ fontSize: 11, color: "#22c55e", marginTop: 4, display: "block" }}>✓ 網址格式正確</span>
              ) : (
                <span style={{ fontSize: 11, color: "#64748b", marginTop: 4, display: "block" }}>貼上 FB 社團、LINE 群組或其他報名頁面的網址</span>
              )}
            </div>

            <F label="備註（選填）" field="notes" type="textarea" placeholder="例：需自備球鞋..."/>

            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button onClick={onClose} style={{ flex: 1, padding: "14px", borderRadius: 14, border: "1px solid rgba(148,163,184,0.2)", background: "transparent", color: "#94a3b8", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>取消</button>
              <button onClick={handleSave}
                style={{ flex: 2, padding: "14px", borderRadius: 14, border: "none", background: "linear-gradient(135deg, #f59e0b, #f97316)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={(e) => { e.target.style.transform = "scale(1.02)"; e.target.style.boxShadow = "0 4px 20px rgba(245,158,11,0.3)"; }}
                onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; e.target.style.boxShadow = "none"; }}
              >💾 儲存變更</button>
            </div>

            {/* Share to FB section */}
            <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
              <button
                onClick={() => onShare && onShare({ ...form, courtName: form.courtName, area: form.area, date: form.date, time: form.time, registered: Number(form.registered), max: Number(form.max), level: form.level, fee: Number(form.fee), host: form.host, signupUrl: form.signupUrl, notes: form.notes })}
                style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(96,165,250,0.3)", background: "rgba(96,165,250,0.08)", color: "#60a5fa", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(96,165,250,0.15)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(96,165,250,0.08)"; }}
              >🔗 分享到 FB</button>
              <button
                onClick={() => onNotify && onNotify(session)}
                style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(6,199,85,0.3)", background: "rgba(6,199,85,0.08)", color: "#06c755", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(6,199,85,0.15)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(6,199,85,0.08)"; }}
              >📣 LINE 通知</button>
            </div>

            {/* Danger zone — close session */}
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px dashed rgba(239,68,68,0.15)" }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8, letterSpacing: "0.04em" }}>危險區域</div>
              <button
                onClick={() => {
                  if (window.confirm("確定要關閉這個場次嗎？\n關閉後場次會立刻從列表中隱藏，資料仍會保留但無法再被報名。此動作無法在前端復原。")) {
                    onCloseSession(session.id);
                  }
                }}
                style={{ width: "100%", padding: "12px", borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)", color: "#ef4444", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={(e) => { e.target.style.background = "rgba(239,68,68,0.12)"; }}
                onMouseLeave={(e) => { e.target.style.background = "rgba(239,68,68,0.06)"; }}
              >🚫 關閉此場次（立刻隱藏）</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

/* ════════════════════════════════════════════
   Create Session Modal (with password)
   ════════════════════════════════════════════ */
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
  const dataPath = dataPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ") + " Z";
  const avg = dims.reduce((s, d) => s + (skills[d.key] || 0), 0) / dims.length;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      {/* Grid */}
      {gridLevels.map(lv => {
        const pts = dims.map((_, i) => getPoint(i, lv));
        return <polygon key={lv} points={pts.map(p => p.join(",")).join(" ")} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth="0.5"/>;
      })}
      {/* Axes */}
      {dims.map((_, i) => {
        const [x, y] = getPoint(i, 5);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(148,163,184,0.12)" strokeWidth="0.5"/>;
      })}
      {/* Data area */}
      <polygon points={dataPoints.map(p => p.join(",")).join(" ")} fill="rgba(167,139,250,0.2)" stroke="#a78bfa" strokeWidth="1.5"/>
      {/* Data dots */}
      {dataPoints.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill="#a78bfa"/>)}
      {/* Labels */}
      {dims.map((d, i) => {
        const [x, y] = getPoint(i, 6.2);
        return <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="central" fill="#94a3b8" fontSize="10" fontFamily="'Noto Sans TC', sans-serif">{d.label}</text>;
      })}
      {/* Center avg */}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill="#a78bfa" fontSize="13" fontWeight="700" fontFamily="'Space Mono', monospace">{avg.toFixed(1)}</text>
    </svg>
  );
};

const PlayerCard = ({ player, onEdit }) => {
  const hasSkills = player.skills && Object.values(player.skills).some(v => v > 0);
  return (
  <div style={{ background: "var(--card-bg)", borderRadius: 16, padding: "18px 22px 18px 26px", border: "1px solid var(--border)", position: "relative", overflow: "hidden", transition: "all 0.25s ease" }}
    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(167,139,250,0.4)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(167,139,250,0.08)"; }}
    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
  >
    <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: "#a78bfa", opacity: 0.85 }}/>
    <button onClick={() => onEdit(player)} title="編輯我的資料" style={{ position: "absolute", top: 10, right: 12, background: "rgba(148,163,184,0.08)", border: "1px solid rgba(148,163,184,0.12)", borderRadius: 8, padding: "5px 8px", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", gap: 4, fontSize: 11, transition: "all 0.2s" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(167,139,250,0.12)"; e.currentTarget.style.color = "#a78bfa"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(148,163,184,0.08)"; e.currentTarget.style.color = "#64748b"; }}
    ><EditIcon /> 編輯</button>

    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      {/* Radar chart on the left */}
      {hasSkills && (
        <div style={{ flexShrink: 0 }}>
          <RadarChart skills={player.skills} size={110}/>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, paddingRight: hasSkills ? 0 : 60 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          {!hasSkills && <span style={{ fontSize: 28 }}>🏐</span>}
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>{player.nickname}</div>
            <div style={{ fontSize: 11, color: "#a78bfa", fontWeight: 600 }}>{player.level}・球齡 {player.experience}</div>
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
              <span key={t} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 12, background: "rgba(96,165,250,0.1)", color: "#60a5fa", fontWeight: 600 }}>{t}</span>
            ))}
          </div>
        )}
        {player.intro && <div style={{ fontSize: 12, color: "var(--text-dim)", fontStyle: "italic", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>💬 {player.intro}</div>}
      </div>
    </div>
  </div>
  );
};

const CreatePlayerModal = ({ open, onClose, onSubmit }) => {
  const [form, setForm] = useState({ nickname: "", experience: "", level: "中階", area: "", position: "", height: "", gender: "", timeSlots: [], intro: "", password: "", skills: { serve: 0, receive: 0, attack: 0, set: 0, block: 0, fitness: 0 } });
  const [errors, setErrors] = useState({});

  useEffect(() => { if (open) { setForm({ nickname: "", experience: "", level: "中階", area: "", position: "", height: "", gender: "", timeSlots: [], intro: "", password: "", skills: { serve: 0, receive: 0, attack: 0, set: 0, block: 0, fitness: 0 } }); setErrors({}); } }, [open]);

  const toggleSlot = (slot) => {
    setForm(f => ({ ...f, timeSlots: f.timeSlots.includes(slot) ? f.timeSlots.filter(s => s !== slot) : [...f.timeSlots, slot] }));
  };

  const handleSubmit = () => {
    const e = {};
    if (!form.nickname.trim()) e.nickname = "必填";
    if (!form.experience.trim()) e.experience = "必填";
    if (!form.area.trim()) e.area = "必填";
    if (!form.password) e.password = "必填（用來保護你的資料）";
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    onSubmit({ nickname: form.nickname.trim(), experience: form.experience.trim(), level: form.level, area: form.area.trim(), position: form.position || "", height: form.height || "", gender: form.gender || "", timeSlots: form.timeSlots, intro: form.intro.trim(), password: form.password, skills: form.skills });
  };

  if (!open) return null;
  const F = ({ label, field, required, type, placeholder, err, children }) => (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label}{required && " *"}</label>
      {children || <input value={form[field]} onChange={(e) => { setForm({...form, [field]: e.target.value}); if (errors[field]) setErrors({...errors, [field]: ""}); }} type={type || "text"} placeholder={placeholder} style={{ ...inputStyle, borderColor: err ? "#ef4444" : "rgba(148,163,184,0.15)" }} onFocus={(e) => { e.target.style.borderColor = "#a78bfa"; }} onBlur={(e) => { e.target.style.borderColor = err ? "#ef4444" : "rgba(148,163,184,0.15)"; }}/>}
      {err && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>{err}</div>}
    </div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 901, maxHeight: "92vh", overflowY: "auto", background: "linear-gradient(180deg, #1a1f35, #0f172a)", borderRadius: "24px 24px 0 0", border: "1px solid rgba(148,163,184,0.12)", borderBottom: "none", animation: "slideUpModal 0.35s cubic-bezier(0.16,1,0.3,1)", boxShadow: "0 -10px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}><div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(148,163,184,0.25)" }}/></div>
        <div style={{ padding: "8px 24px 32px", maxWidth: 520, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#a78bfa" }}>🙋 註冊球員資料</h2>
            <button onClick={onClose} style={{ background: "rgba(148,163,184,0.1)", border: "none", borderRadius: 10, padding: 8, cursor: "pointer", color: "#94a3b8", display: "flex" }}><CloseIcon/></button>
          </div>

          <F label="暱稱" field="nickname" required placeholder="你想被怎麼稱呼？" err={errors.nickname}/>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><F label="球齡" field="experience" required placeholder="例：3年" err={errors.experience}/></div>
            <div style={{ flex: 1 }}><F label="程度" field="level">{
              <select value={form.level} onChange={(e) => setForm({...form, level: e.target.value})} style={{ ...inputStyle, cursor: "pointer" }}>{LEVELS_INPUT.map(l => <option key={l} value={l}>{l}</option>)}</select>
            }</F></div>
          </div>
          <F label="常打地區" field="area" required placeholder="例：大安區、信義區" err={errors.area}/>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><F label="慣用位置（選填）" field="position">{
              <select value={form.position} onChange={(e) => setForm({...form, position: e.target.value})} style={{ ...inputStyle, cursor: "pointer" }}><option value="">-- 選擇 --</option>{POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}</select>
            }</F></div>
            <div style={{ flex: 1 }}><F label="性別（選填）" field="gender">{
              <select value={form.gender} onChange={(e) => setForm({...form, gender: e.target.value})} style={{ ...inputStyle, cursor: "pointer" }}><option value="">-- 選擇 --</option><option value="男">男</option><option value="女">女</option><option value="不透露">不透露</option></select>
            }</F></div>
          </div>
          <F label="身高 cm（選填）" field="height" type="number" placeholder="例：175"/>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>可打時段（多選）</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {TIME_SLOTS.map(slot => (
                <button key={slot} onClick={() => toggleSlot(slot)}
                  style={{ padding: "6px 14px", borderRadius: 10, border: "1px solid", borderColor: form.timeSlots.includes(slot) ? "#a78bfa" : "rgba(148,163,184,0.2)", background: form.timeSlots.includes(slot) ? "rgba(167,139,250,0.12)" : "transparent", color: form.timeSlots.includes(slot) ? "#a78bfa" : "var(--text-secondary)", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
                >{slot}</button>
              ))}
            </div>
          </div>

          <F label="自我介紹（選填）" field="intro">{
            <textarea value={form.intro} onChange={(e) => setForm({...form, intro: e.target.value})} placeholder="例：週末固定打球，喜歡 6-2 陣型，歡迎約打！" rows={3} style={{ ...inputStyle, resize: "vertical", minHeight: 60 }} onFocus={(e) => { e.target.style.borderColor = "#a78bfa"; }} onBlur={(e) => { e.target.style.borderColor = "rgba(148,163,184,0.15)"; }}/>
          }</F>

          {/* Skill evaluation */}
          <div style={{ marginBottom: 18, padding: "16px", borderRadius: 14, background: "rgba(167,139,250,0.04)", border: "1px solid rgba(167,139,250,0.15)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#a78bfa" }}>📊 技能自評</span>
              <span style={{ fontSize: 11, color: "#64748b" }}>選擇最符合你的描述</span>
            </div>
            {/* Preview radar */}
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
                        style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid", borderColor: selected ? "#a78bfa" : "rgba(148,163,184,0.12)", background: selected ? "rgba(167,139,250,0.12)" : "transparent", cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}>
                        <span style={{ minWidth: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, background: selected ? "#a78bfa" : "rgba(148,163,184,0.1)", color: selected ? "#fff" : "#94a3b8", flexShrink: 0 }}>{lv}</span>
                        <div>
                          <span style={{ fontSize: 10, color: selected ? "#a78bfa" : "#64748b", fontWeight: 600 }}>{LEVEL_TAGS[i]}</span>
                          <div style={{ fontSize: 12, color: selected ? "var(--text-primary)" : "var(--text-secondary)", lineHeight: 1.5 }}>{desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <F label="設定密碼（用來保護你的資料）" field="password" type="password" required placeholder="之後編輯/刪除時需要" err={errors.password}/>

          <button onClick={handleSubmit}
            style={{ width: "100%", padding: "14px", borderRadius: 14, border: "none", background: "linear-gradient(135deg, #a78bfa, #8b5cf6)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
            onMouseEnter={(e) => { e.target.style.transform = "scale(1.02)"; }}
            onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; }}
          >✅ 發佈球員資料</button>
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
  const F = ({ label, field, type, placeholder, children }) => (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label}</label>
      {children || <input value={form[field] || ""} onChange={(e) => setForm({...form, [field]: e.target.value})} type={type || "text"} placeholder={placeholder} style={inputStyle} onFocus={(e) => { e.target.style.borderColor = "#a78bfa"; }} onBlur={(e) => { e.target.style.borderColor = "rgba(148,163,184,0.15)"; }}/>}
    </div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 901, maxHeight: "92vh", overflowY: "auto", background: "linear-gradient(180deg, #1a1f35, #0f172a)", borderRadius: "24px 24px 0 0", border: "1px solid rgba(148,163,184,0.12)", borderBottom: "none", animation: "slideUpModal 0.35s cubic-bezier(0.16,1,0.3,1)", boxShadow: "0 -10px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}><div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(148,163,184,0.25)" }}/></div>
        <div style={{ padding: "8px 24px 32px", maxWidth: 520, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#a78bfa" }}>✏️ 編輯球員資料</h2>
            <button onClick={onClose} style={{ background: "rgba(148,163,184,0.1)", border: "none", borderRadius: 10, padding: 8, cursor: "pointer", color: "#94a3b8", display: "flex" }}><CloseIcon/></button>
          </div>
          <F label="暱稱 *" field="nickname" placeholder="你想被怎麼稱呼？"/>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><F label="球齡 *" field="experience" placeholder="例：3年"/></div>
            <div style={{ flex: 1 }}><F label="程度" field="level">{<select value={form.level} onChange={(e) => setForm({...form, level: e.target.value})} style={{ ...inputStyle, cursor: "pointer" }}>{LEVELS_INPUT.map(l => <option key={l} value={l}>{l}</option>)}</select>}</F></div>
          </div>
          <F label="常打地區 *" field="area" placeholder="例：大安區"/>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><F label="慣用位置" field="position">{<select value={form.position} onChange={(e) => setForm({...form, position: e.target.value})} style={{ ...inputStyle, cursor: "pointer" }}><option value="">--</option>{POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}</select>}</F></div>
            <div style={{ flex: 1 }}><F label="性別" field="gender">{<select value={form.gender} onChange={(e) => setForm({...form, gender: e.target.value})} style={{ ...inputStyle, cursor: "pointer" }}><option value="">--</option><option value="男">男</option><option value="女">女</option><option value="不透露">不透露</option></select>}</F></div>
          </div>
          <F label="身高 cm" field="height" type="number" placeholder="175"/>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>可打時段</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {TIME_SLOTS.map(slot => (
                <button key={slot} onClick={() => toggleSlot(slot)} style={{ padding: "6px 14px", borderRadius: 10, border: "1px solid", borderColor: form.timeSlots?.includes(slot) ? "#a78bfa" : "rgba(148,163,184,0.2)", background: form.timeSlots?.includes(slot) ? "rgba(167,139,250,0.12)" : "transparent", color: form.timeSlots?.includes(slot) ? "#a78bfa" : "var(--text-secondary)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{slot}</button>
              ))}
            </div>
          </div>
          <F label="自我介紹" field="intro">{<textarea value={form.intro} onChange={(e) => setForm({...form, intro: e.target.value})} placeholder="歡迎約打！" rows={3} style={{ ...inputStyle, resize: "vertical", minHeight: 60 }} onFocus={(e) => { e.target.style.borderColor = "#a78bfa"; }} onBlur={(e) => { e.target.style.borderColor = "rgba(148,163,184,0.15)"; }}/>}</F>

          {/* Skill evaluation */}
          <div style={{ marginBottom: 18, padding: "16px", borderRadius: 14, background: "rgba(167,139,250,0.04)", border: "1px solid rgba(167,139,250,0.15)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#a78bfa" }}>📊 技能自評</span>
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
                        style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid", borderColor: selected ? "#a78bfa" : "rgba(148,163,184,0.12)", background: selected ? "rgba(167,139,250,0.12)" : "transparent", cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}>
                        <span style={{ minWidth: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, background: selected ? "#a78bfa" : "rgba(148,163,184,0.1)", color: selected ? "#fff" : "#94a3b8", flexShrink: 0 }}>{lv}</span>
                        <div>
                          <span style={{ fontSize: 10, color: selected ? "#a78bfa" : "#64748b", fontWeight: 600 }}>{LEVEL_TAGS[i]}</span>
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
            <button onClick={onClose} style={{ flex: 1, padding: "14px", borderRadius: 14, border: "1px solid rgba(148,163,184,0.2)", background: "transparent", color: "#94a3b8", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>取消</button>
            <button onClick={() => onSave(player.id, form)} style={{ flex: 2, padding: "14px", borderRadius: 14, border: "none", background: "linear-gradient(135deg, #a78bfa, #8b5cf6)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>💾 儲存</button>
          </div>
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px dashed rgba(239,68,68,0.15)" }}>
            <button onClick={() => onDelete(player.id)} style={{ width: "100%", padding: "12px", borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)", color: "#ef4444", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🗑️ 刪除我的資料</button>
          </div>
        </div>
      </div>
    </>
  );
};

const LAST_FORM_KEY = "vb_last_create_form";

const CreateSessionModal = ({ open, onClose, onSubmit }) => {
  const defaultForm = { courtName: "", area: "", date: getToday(), startTime: "19:00", currentPeople: "1", maxPeople: "16", level: "中階", fee: "", hostName: "", signupUrl: "", notes: "", password: "" };

  // Load saved form from localStorage, but always use fresh date/time
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

  // Load saved form when modal opens
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

    // Save form to localStorage for next time (exclude password for security)
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
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 900, animation: "fadeIn 0.25s ease" }}/>
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 901, maxHeight: "92vh", overflowY: "auto", background: "linear-gradient(180deg, #1a1f35, #0f172a)", borderRadius: "24px 24px 0 0", border: "1px solid rgba(148,163,184,0.12)", borderBottom: "none", animation: "slideUpModal 0.35s cubic-bezier(0.16,1,0.3,1)", boxShadow: "0 -10px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}><div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(148,163,184,0.25)" }}/></div>
        <div style={{ padding: "8px 24px 32px", maxWidth: 520, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "#f59e0b", marginBottom: 4 }}>🏐 我要開場</h2>
              <p style={{ fontSize: 12, color: "#64748b" }}>{step === 1 ? "步驟 1/2 — 場地與主揪" : "步驟 2/2 — 場次細節"}</p>
            </div>
            <button onClick={onClose} style={{ background: "rgba(148,163,184,0.1)", border: "none", borderRadius: 10, padding: 8, cursor: "pointer", color: "#94a3b8", display: "flex" }}><CloseIcon/></button>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>{[1,2].map(s => (<div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: s <= step ? "#f59e0b" : "rgba(148,163,184,0.15)", transition: "background 0.3s ease" }}/>))}</div>

          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "fadeIn 0.3s ease" }}>
              <div>
                <label style={labelStyle}>場地名稱 *</label>
                <input value={form.courtName} onChange={(e) => setForm({...form, courtName: e.target.value})} placeholder="例：大安運動中心、XX國小體育館" style={{...inputStyle, borderColor: errors.courtName ? "#ef4444" : "rgba(148,163,184,0.15)"}} onFocus={(e)=>{e.target.style.borderColor="#f59e0b";}} onBlur={(e)=>{e.target.style.borderColor=errors.courtName?"#ef4444":"rgba(148,163,184,0.15)";}}/>
                {errors.courtName && <span style={{ fontSize: 11, color: "#ef4444", marginTop: 4, display: "block" }}>{errors.courtName}</span>}
              </div>
              <div>
                <label style={labelStyle}>地區 *</label>
                <input value={form.area} onChange={(e) => setForm({...form, area: e.target.value})} placeholder="例：大安區、信義區、新莊區" style={{...inputStyle, borderColor: errors.area ? "#ef4444" : "rgba(148,163,184,0.15)"}} onFocus={(e)=>{e.target.style.borderColor="#f59e0b";}} onBlur={(e)=>{e.target.style.borderColor=errors.area?"#ef4444":"rgba(148,163,184,0.15)";}}/>
                {errors.area && <span style={{ fontSize: 11, color: "#ef4444", marginTop: 4, display: "block" }}>{errors.area}</span>}
              </div>
              <div>
                <label style={labelStyle}>你的名稱（暱稱）*</label>
                <input value={form.hostName} onChange={(e) => setForm({...form, hostName: e.target.value})} placeholder="讓大家知道誰在揪" style={{...inputStyle, borderColor: errors.hostName ? "#ef4444" : "rgba(148,163,184,0.15)"}} onFocus={(e)=>{e.target.style.borderColor="#f59e0b";}} onBlur={(e)=>{e.target.style.borderColor=errors.hostName?"#ef4444":"rgba(148,163,184,0.15)";}}/>
                {errors.hostName && <span style={{ fontSize: 11, color: "#ef4444", marginTop: 4, display: "block" }}>{errors.hostName}</span>}
              </div>
              {/* Password field */}
              <div>
                <label style={labelStyle}>🔒 編輯密碼 *</label>
                <input type="password" value={form.password} onChange={(e) => setForm({...form, password: e.target.value})} placeholder="設定密碼，之後修改場次時需要驗證" style={{...inputStyle, borderColor: errors.password ? "#ef4444" : "rgba(148,163,184,0.15)"}} onFocus={(e)=>{e.target.style.borderColor="#f59e0b";}} onBlur={(e)=>{e.target.style.borderColor=errors.password?"#ef4444":"rgba(148,163,184,0.15)";}}/>
                {errors.password && <span style={{ fontSize: 11, color: "#ef4444", marginTop: 4, display: "block" }}>{errors.password}</span>}
                <span style={{ fontSize: 11, color: "#64748b", marginTop: 4, display: "block" }}>此密碼用於日後編輯場次資訊，請牢記</span>
              </div>
              <button onClick={() => { const e = {}; if (!form.courtName.trim()) e.courtName = "請輸入場地名稱"; if (!form.area.trim()) e.area = "請輸入地區"; if (!form.hostName.trim()) e.hostName = "請輸入你的名稱"; if (!form.password) e.password = "請設定編輯密碼"; setErrors(e); if (Object.keys(e).length === 0) setStep(2); }}
                style={{ padding: "14px", borderRadius: 14, border: "none", marginTop: 4, background: "linear-gradient(135deg, #f59e0b, #f97316)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={(e) => { e.target.style.transform = "scale(1.02)"; e.target.style.boxShadow = "0 4px 20px rgba(245,158,11,0.3)"; }}
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
                  <input type="number" min="1" max="18" value={form.currentPeople} onChange={(e) => setForm({...form, currentPeople: e.target.value})} style={{...inputStyle, borderColor: errors.currentPeople ? "#ef4444" : "rgba(148,163,184,0.15)"}}/>
                  {errors.currentPeople && <span style={{ fontSize: 11, color: "#ef4444", marginTop: 4, display: "block" }}>{errors.currentPeople}</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>人數上限</label>
                  <input type="number" min="12" max="24" value={form.maxPeople} onChange={(e) => setForm({...form, maxPeople: e.target.value})} style={{...inputStyle, borderColor: errors.maxPeople ? "#ef4444" : "rgba(148,163,184,0.15)"}}/>
                  {errors.maxPeople && <span style={{ fontSize: 11, color: "#ef4444", marginTop: 4, display: "block" }}>{errors.maxPeople}</span>}
                </div>
              </div>
              {Number(form.currentPeople) >= 1 && Number(form.currentPeople) < 12 && (
                <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", fontSize: 13, color: "#f59e0b" }}>🔥 還差 <strong>{12 - Number(form.currentPeople)}</strong> 人可以成團（最低 12 人）</div>
              )}
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}><label style={labelStyle}>程度 *</label><select value={form.level} onChange={(e) => setForm({...form, level: e.target.value})} style={{...inputStyle, cursor: "pointer"}}>{LEVELS_INPUT.map(l => <option key={l} value={l}>{l}</option>)}</select></div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>每人費用 (NT$) *</label>
                  <input type="number" min="0" step="10" value={form.fee} onChange={(e) => setForm({...form, fee: e.target.value})} placeholder="例：150" style={{...inputStyle, borderColor: errors.fee ? "#ef4444" : "rgba(148,163,184,0.15)"}}/>
                  {errors.fee && <span style={{ fontSize: 11, color: "#ef4444", marginTop: 4, display: "block" }}>{errors.fee}</span>}
                </div>
              </div>
              <div>
                <label style={labelStyle}>報名連結（選填）</label>
                <input value={form.signupUrl} onChange={(e) => setForm({...form, signupUrl: e.target.value})} placeholder="例：https://www.facebook.com/groups/..."
                  style={{
                    ...inputStyle,
                    borderColor: form.signupUrl && !isValidUrl(form.signupUrl) ? "#ef4444" : (form.signupUrl && isValidUrl(form.signupUrl) ? "#22c55e" : "rgba(148,163,184,0.15)")
                  }}
                  onFocus={(e)=>{
                    if (!form.signupUrl) e.target.style.borderColor = "#f59e0b";
                  }}
                  onBlur={(e)=>{
                    e.target.style.borderColor = form.signupUrl && !isValidUrl(form.signupUrl) ? "#ef4444" : (form.signupUrl && isValidUrl(form.signupUrl) ? "#22c55e" : "rgba(148,163,184,0.15)");
                  }}
                />
                {form.signupUrl && !isValidUrl(form.signupUrl) ? (
                  <span style={{ fontSize: 11, color: "#ef4444", marginTop: 4, display: "block" }}>⚠️ 這不是有效的網址，請以 http:// 或 https:// 開頭（留空也 OK）</span>
                ) : form.signupUrl && isValidUrl(form.signupUrl) ? (
                  <span style={{ fontSize: 11, color: "#22c55e", marginTop: 4, display: "block" }}>✓ 網址格式正確</span>
                ) : (
                  <span style={{ fontSize: 11, color: "#64748b", marginTop: 4, display: "block" }}>貼上 FB 社團、LINE 群組或其他報名頁面的網址</span>
                )}
              </div>
              <div>
                <label style={labelStyle}>備註（選填）</label>
                <textarea value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} placeholder="例：需要自備球鞋、有停車場、冷氣開放..." rows={2} style={{...inputStyle, resize: "vertical", minHeight: 60}} onFocus={(e)=>{e.target.style.borderColor="#f59e0b";}} onBlur={(e)=>{e.target.style.borderColor="rgba(148,163,184,0.15)";}}/>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button onClick={() => setStep(1)} style={{ flex: 1, padding: "14px", borderRadius: 14, border: "1px solid rgba(148,163,184,0.2)", background: "transparent", color: "#94a3b8", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>← 上一步</button>
                <button onClick={handleSubmit} style={{ flex: 2, padding: "14px", borderRadius: 14, border: "none", background: "linear-gradient(135deg, #f59e0b, #f97316)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={(e) => { e.target.style.transform = "scale(1.02)"; e.target.style.boxShadow = "0 4px 20px rgba(245,158,11,0.3)"; }}
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
  const [activeTab, setActiveTab] = useState("sessions"); // "sessions" | "buddies"
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

  const toast = (msg, duration = 2500, type = "success") => { setShowToast({ msg, type }); setTimeout(() => setShowToast(null), duration); };

  // Ticker to refresh time-based filtering every minute
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  // localStorage helpers for tracking "sessions I joined"
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

  // Initialize joined from localStorage on mount
  useEffect(() => {
    setJoinedSessions(loadJoined());
    setWaitlistedSessions(loadWaitlist());
  }, []);

  // Check if a session has already started (based on date + time)
  const hasSessionStarted = (session) => {
    if (!session.date || !session.time) return false;
    const startStr = session.time.split("\u2013")[0].trim();
    const [h, m] = startStr.split(":").map(Number);
    const [y, mo, d] = session.date.split("-").map(Number);
    const sessionStart = new Date(y, mo - 1, d, h || 0, m || 0);
    return sessionStart.getTime() <= Date.now();
  };

  // Detect ?admin=1 URL or restore admin session
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

  // Subscribe to Firestore — auto-updates whenever data changes
  useEffect(() => {
    const q = query(sessionsRef, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const list = [];
      snap.forEach(d => {
        const data = d.data();
        // Hide closed sessions from UI (admin still sees them)
        if (data.closed && !isAdmin) return;
        list.push({ id: d.id, ...data });
      });
      setSessions(list);
      // Collect unique areas into filter
      list.forEach(s => { if (s.area && !AREAS_FILTER.includes(s.area)) AREAS_FILTER.push(s.area); });
      setLoading(false);
    }, (err) => {
      console.error("Firestore 讀取錯誤：", err);
      toast("連線失敗，請檢查網路或 Firebase 設定", 4000, "warn");
      setLoading(false);
    });
    return () => unsub();
  }, [isAdmin]);

  // Subscribe to players collection
  useEffect(() => {
    const q2 = query(collection(db, "players"), orderBy("createdAt", "desc"));
    const unsub2 = onSnapshot(q2, (snap) => {
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      setPlayers(list);
    }, (err) => console.error("Players 讀取錯誤：", err));
    return () => unsub2();
  }, []);

  // Generate a 6-char random binding code
  const generateBindingCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // exclude confusing chars: 0OI1
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

      // Generate and save binding code
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

  // Admin-only: permanently delete a session from Firestore
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

  // Admin-only: adjust registered or waitlist count by +1 / -1
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
      // Open share modal with the newly created session data
      setShareData(data);
      setShowShareModal(true);
    } catch (err) {
      console.error(err);
      toast("發佈失敗，請稍後再試", 3000, "warn");
    }
  };

  // Open share modal for an existing session (from the edit modal's "share" button)
  const handleOpenShareModal = (session) => {
    setShareData(session);
    setShowShareModal(true);
  };

  // ── Player (buddy) handlers ──
  const handleCreatePlayer = async (data) => {
    try {
      await addDoc(collection(db, "players"), {
        ...data, createdAt: serverTimestamp(),
      });
      setShowCreatePlayerModal(false);
      toast("球員資料已發佈！🏐");
    } catch (err) {
      console.error(err);
      toast("發佈失敗，請稍後再試", 3000, "warn");
    }
  };

  const handleEditPlayerClick = (player) => {
    setEditPlayerTarget(player);
    setShowPlayerPasswordModal(true);
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
    // Admin skips password verification
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

  // nowTick dependency ensures time-based filter re-evaluates every minute
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
    <div style={{ "--text-primary": "#e2e8f0", "--text-secondary": "#94a3b8", "--text-dim": "#64748b", "--card-bg": "rgba(15,23,42,0.6)", "--border": "rgba(148,163,184,0.1)", "--surface": "rgba(15,23,42,0.4)", minHeight: "100vh", background: "linear-gradient(160deg, #0c1222 0%, #0f172a 40%, #14102a 100%)", color: "var(--text-primary)", fontFamily: "'Noto Sans TC', 'Noto Sans', -apple-system, sans-serif", padding: "0 0 100px", position: "relative", boxShadow: isAdmin ? "inset 0 0 0 3px #ef4444, inset 0 0 40px rgba(239,68,68,0.15)" : "none" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700;900&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { height: 4px; width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.2); border-radius: 4px; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideUpModal { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        @keyframes toastIn { from { opacity: 0; transform: translateY(20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes glow { 0%, 100% { box-shadow: 0 0 12px rgba(245,158,11,0.3); } 50% { box-shadow: 0 0 24px rgba(245,158,11,0.5); } }
        @keyframes adminPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
        @keyframes ringBump { 0%, 100% { transform: scale(1); } 30% { transform: scale(1.18); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        input[type="number"]::-webkit-inner-spin-button, input[type="number"]::-webkit-outer-spin-button { opacity: 1; }
      `}</style>

      {/* Admin mode banner */}
      {isAdmin && (
        <div style={{ position: "sticky", top: 0, zIndex: 500, background: "linear-gradient(90deg, #ef4444, #dc2626)", color: "#fff", padding: "8px 16px", textAlign: "center", fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, boxShadow: "0 2px 12px rgba(239,68,68,0.3)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, animation: "adminPulse 2s ease infinite" }}>
            <ShieldIcon/> 管理模式中
          </span>
          <span style={{ opacity: 0.7, fontSize: 11, fontWeight: 400 }}>| 你現在擁有最高權限</span>
          <button onClick={handleAdminLogout} style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", padding: "3px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", marginLeft: 8 }}>登出</button>
        </div>
      )}

      <div style={{ padding: "32px 24px 24px", background: "linear-gradient(180deg, rgba(15,23,42,0.9) 0%, transparent 100%)", borderBottom: "1px solid var(--border)", marginBottom: 20, position: "relative", overflow: "hidden" }}>
        {/* Decorative gradient blobs */}
        <div style={{ position: "absolute", top: -40, right: -40, width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle, rgba(245,158,11,0.15), transparent 70%)", pointerEvents: "none" }}/>
        <div style={{ position: "absolute", bottom: -60, left: -30, width: 140, height: 140, borderRadius: "50%", background: "radial-gradient(circle, rgba(167,139,250,0.08), transparent 70%)", pointerEvents: "none" }}/>
        <div style={{ maxWidth: 720, margin: "0 auto", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <div style={{ color: "#f59e0b" }}><VolleyballIcon/></div>
            <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-0.02em", background: "linear-gradient(135deg, #f59e0b, #f97316)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>排球揪團雷達</h1>
            <span style={{ marginLeft: "auto", fontSize: 10, padding: "3px 8px", borderRadius: 12, background: "rgba(245,158,11,0.1)", color: "#f59e0b", fontWeight: 700, letterSpacing: "0.1em", border: "1px solid rgba(245,158,11,0.2)" }}>TAIPEI</span>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>即時掌握台北各場館的排球場次，快速找到缺人的場，讓每一場都能順利開打</p>
        </div>
      </div>

      {/* Tab switcher */}
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 16px" }}>
        <div style={{ display: "flex", marginBottom: 20, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)", background: "var(--surface)" }}>
          <button onClick={() => setActiveTab("sessions")}
            style={{ flex: 1, padding: "12px", border: "none", background: activeTab === "sessions" ? "rgba(245,158,11,0.15)" : "transparent", color: activeTab === "sessions" ? "#f59e0b" : "var(--text-secondary)", fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "all 0.2s", borderBottom: activeTab === "sessions" ? "2px solid #f59e0b" : "2px solid transparent" }}
          >🏐 場次揪團</button>
          <button onClick={() => setActiveTab("buddies")}
            style={{ flex: 1, padding: "12px", border: "none", background: activeTab === "buddies" ? "rgba(167,139,250,0.15)" : "transparent", color: activeTab === "buddies" ? "#a78bfa" : "var(--text-secondary)", fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "all 0.2s", borderBottom: activeTab === "buddies" ? "2px solid #a78bfa" : "2px solid transparent" }}
          >🙋 排球夾伴 <span style={{ fontSize: 11, opacity: 0.7 }}>({players.length})</span></button>
        </div>
      </div>

      {/* ═══ Sessions Tab ═══ */}
      {activeTab === "sessions" && <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 16px" }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 20, justifyContent: "center", flexWrap: "wrap", animation: "slideUp 0.4s ease" }}>
          <StatBadge value={allSessions.length} label="場次" color="#60a5fa"/>
          <StatBadge value={totalPlayers} label="已報名" color="#a78bfa"/>
          <StatBadge value={needPeople.length} label="缺人中" color="#f59e0b"/>
          <StatBadge value={formed.length} label="已成團" color="#22c55e"/>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14, justifyContent: "center" }}>
          {DATES.map(d => {
            const count = sessions.filter(s => s.date === d.value && !hasSessionStarted(s)).length;
            const isSelected = selectedDate === d.value;
            return (
              <button key={d.value} onClick={() => setSelectedDate(d.value)} style={{ position: "relative", padding: "8px 20px", borderRadius: 10, border: "1px solid", borderColor: isSelected ? "#f59e0b" : "var(--border)", background: isSelected ? "rgba(245,158,11,0.12)" : "transparent", color: isSelected ? "#f59e0b" : "var(--text-secondary)", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}>
                {d.label}<span style={{ fontSize: 11, opacity: 0.6, marginLeft: 4 }}>{d.value.slice(5).replace("-","/")}</span>
                {count > 0 && (
                  <span style={{ position: "absolute", top: -6, right: -6, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: isSelected ? "#f59e0b" : "#60a5fa", color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(0,0,0,0.3)" }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", padding: "12px 16px", background: "var(--surface)", borderRadius: 14, border: "1px solid var(--border)" }}>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4, letterSpacing: "0.04em", fontWeight: 600 }}>📍 地區</label>
            <select value={selectedArea} onChange={(e) => setSelectedArea(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 8, background: "rgba(15,23,42,0.8)", border: "1px solid var(--border)", color: selectedArea !== "全部" ? "#f59e0b" : "var(--text-primary)", fontSize: 13, fontWeight: selectedArea !== "全部" ? 600 : 400, cursor: "pointer", transition: "all 0.2s" }}
              onFocus={(e) => { e.target.style.borderColor = "#f59e0b"; }}
              onBlur={(e) => { e.target.style.borderColor = "var(--border)"; }}
            >{AREAS_FILTER.map(a => <option key={a} value={a}>{a}</option>)}</select>
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4, letterSpacing: "0.04em", fontWeight: 600 }}>🏐 程度</label>
            <select value={selectedLevel} onChange={(e) => setSelectedLevel(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 8, background: "rgba(15,23,42,0.8)", border: "1px solid var(--border)", color: selectedLevel !== "全部" ? "#f59e0b" : "var(--text-primary)", fontSize: 13, fontWeight: selectedLevel !== "全部" ? 600 : 400, cursor: "pointer", transition: "all 0.2s" }}
              onFocus={(e) => { e.target.style.borderColor = "#f59e0b"; }}
              onBlur={(e) => { e.target.style.borderColor = "var(--border)"; }}
            >{LEVELS.map(l => <option key={l} value={l}>{l}</option>)}</select>
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4, letterSpacing: "0.04em", fontWeight: 600 }}>🔀 排序</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 8, background: "rgba(15,23,42,0.8)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: 13, cursor: "pointer", transition: "all 0.2s" }}
              onFocus={(e) => { e.target.style.borderColor = "#f59e0b"; }}
              onBlur={(e) => { e.target.style.borderColor = "var(--border)"; }}
            ><option value="need">缺人優先</option><option value="time">時間排序</option><option value="fee">費用低→高</option></select>
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, marginBottom: 18, justifyContent: "center", flexWrap: "wrap", fontSize: 11, color: "var(--text-dim)" }}>
          {[{color:"#ef4444",label:"募集中"},{color:"#f59e0b",label:"即將成團（差≤3人）"},{color:"#22c55e",label:"已成團"},{color:"#94a3b8",label:"已滿"}].map(item => (
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
            <div style={{ textAlign: "center", padding: "48px 24px", background: "rgba(15,23,42,0.3)", borderRadius: 16, border: "1px dashed rgba(148,163,184,0.15)" }}>
              <div style={{ fontSize: 56, marginBottom: 12, opacity: 0.7 }}>🏐</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>這個時段還沒有場次</div>
              <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 20 }}>換個日期看看，或是直接揪一場吧！</div>
              <button onClick={() => setShowCreateModal(true)} style={{ padding: "10px 24px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #f59e0b, #f97316)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 16px rgba(245,158,11,0.25)", transition: "all 0.2s" }}
                onMouseEnter={(e) => { e.target.style.transform = "translateY(-2px)"; e.target.style.boxShadow = "0 6px 20px rgba(245,158,11,0.35)"; }}
                onMouseLeave={(e) => { e.target.style.transform = "translateY(0)"; e.target.style.boxShadow = "0 4px 16px rgba(245,158,11,0.25)"; }}
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
          <div style={{ marginTop: 24, padding: "16px 20px", borderRadius: 14, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", fontSize: 13, color: "#f59e0b", textAlign: "center", lineHeight: 1.6 }}>
            <span style={{ animation: "pulse 2s ease infinite" }}>🔥</span>
            {" "}目前有 <strong>{needPeople.length}</strong> 個場次正在等人成團，
            總共還差 <strong>{needPeople.reduce((sum,s) => sum + Math.max(0, s.min - s.registered), 0)}</strong> 人！
          </div>
        )}
      </div>}

      {/* ═══ Buddies Tab ═══ */}
      {activeTab === "buddies" && <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 16px" }}>
        {/* Stats */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20, justifyContent: "center", flexWrap: "wrap", animation: "slideUp 0.4s ease" }}>
          <StatBadge value={players.length} label="球員" color="#a78bfa"/>
          <StatBadge value={players.filter(p => p.level === "中階" || p.level === "中高階").length} label="中階以上" color="#60a5fa"/>
          <StatBadge value={[...new Set(players.map(p => p.area))].length} label="活躍地區" color="#f59e0b"/>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", padding: "12px 16px", background: "var(--surface)", borderRadius: 14, border: "1px solid var(--border)" }}>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4, letterSpacing: "0.04em", fontWeight: 600 }}>📍 地區</label>
            <select value={playerFilterArea} onChange={(e) => setPlayerFilterArea(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 8, background: "rgba(15,23,42,0.8)", border: "1px solid var(--border)", color: playerFilterArea !== "全部" ? "#a78bfa" : "var(--text-primary)", fontSize: 13, fontWeight: playerFilterArea !== "全部" ? 600 : 400, cursor: "pointer" }}
            ><option value="全部">全部</option>{[...new Set(players.map(p => p.area).filter(Boolean))].map(a => <option key={a} value={a}>{a}</option>)}</select>
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4, letterSpacing: "0.04em", fontWeight: 600 }}>🏐 程度</label>
            <select value={playerFilterLevel} onChange={(e) => setPlayerFilterLevel(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 8, background: "rgba(15,23,42,0.8)", border: "1px solid var(--border)", color: playerFilterLevel !== "全部" ? "#a78bfa" : "var(--text-primary)", fontSize: 13, fontWeight: playerFilterLevel !== "全部" ? 600 : 400, cursor: "pointer" }}
            ><option value="全部">全部</option>{LEVELS_INPUT.map(l => <option key={l} value={l}>{l}</option>)}</select>
          </div>
        </div>

        {/* Player list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {players
            .filter(p => playerFilterArea === "全部" || p.area === playerFilterArea)
            .filter(p => playerFilterLevel === "全部" || p.level === playerFilterLevel)
            .map((p, i) => (
            <div key={p.id} style={{ animation: `slideUp 0.4s ease ${i * 0.06}s both` }}>
              <PlayerCard player={p} onEdit={handleEditPlayerClick}/>
            </div>
          ))}
          {players.filter(p => playerFilterArea === "全部" || p.area === playerFilterArea).filter(p => playerFilterLevel === "全部" || p.level === playerFilterLevel).length === 0 && (
            <div style={{ textAlign: "center", padding: "48px 24px", background: "rgba(15,23,42,0.3)", borderRadius: 16, border: "1px dashed rgba(148,163,184,0.15)" }}>
              <div style={{ fontSize: 56, marginBottom: 12, opacity: 0.7 }}>🙋</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>還沒有球員資料</div>
              <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 20 }}>成為第一個註冊的球員吧！</div>
              <button onClick={() => setShowCreatePlayerModal(true)} style={{ padding: "10px 24px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #a78bfa, #8b5cf6)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>🙋 我要註冊</button>
            </div>
          )}
        </div>
      </div>}

      {/* FAB — changes based on active tab */}
      {activeTab === "sessions" ? (
        <button onClick={() => setShowCreateModal(true)}
          title="我要開場"
          style={{ position: "fixed", bottom: 24, right: 24, zIndex: 800, height: 60, padding: "0 22px", borderRadius: 30, border: "none", background: "linear-gradient(135deg, #f59e0b, #f97316)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 24px rgba(245,158,11,0.4)", transition: "all 0.25s ease", animation: "glow 3s ease infinite", fontSize: 14, fontWeight: 700 }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = "0 6px 28px rgba(245,158,11,0.55)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 4px 24px rgba(245,158,11,0.4)"; }}
        ><PlusIcon/><span>我要開場</span></button>
      ) : (
        <button onClick={() => setShowCreatePlayerModal(true)}
          title="我要註冊"
          style={{ position: "fixed", bottom: 24, right: 24, zIndex: 800, height: 60, padding: "0 22px", borderRadius: 30, border: "none", background: "linear-gradient(135deg, #a78bfa, #8b5cf6)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 24px rgba(167,139,250,0.4)", transition: "all 0.25s ease", animation: "glow 3s ease infinite", fontSize: 14, fontWeight: 700 }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = "0 6px 28px rgba(167,139,250,0.55)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 4px 24px rgba(167,139,250,0.4)"; }}
        ><PlusIcon/><span>我要註冊</span></button>
      )}

      <CreateSessionModal open={showCreateModal} onClose={() => setShowCreateModal(false)} onSubmit={handleCreateSession}/>

      <PasswordModal open={showPasswordModal} onClose={() => { setShowPasswordModal(false); setEditTarget(null); }} onVerify={handlePasswordVerify} sessionId={editTarget?.session?.id}/>

      <EditSessionModal open={showEditModal} onClose={() => { setShowEditModal(false); setEditTarget(null); }} session={editTarget?.session} courtName={editTarget?.courtName} area={editTarget?.area} onSave={handleSaveEdit} onCloseSession={handleCloseSession} onShare={handleOpenShareModal} onNotify={handleOpenNotifyModal}/>

      <CommentModal open={showCommentModal} onClose={() => { setShowCommentModal(false); setCommentTarget(null); }} session={commentTarget} onSubmit={handleAddComment}/>

      <AdminLoginModal open={showAdminLoginModal} onClose={() => setShowAdminLoginModal(false)} onLogin={handleAdminLogin}/>

      <ShareModal open={showShareModal} onClose={() => { setShowShareModal(false); setShareData(null); }} data={shareData}/>

      <NotifyModal open={showNotifyModal} onClose={() => { setShowNotifyModal(false); setNotifyTarget(null); }} session={notifyTarget} onSend={handleSendLineNotification}/>

      <BindingCodeModal open={showBindingModal} onClose={() => { setShowBindingModal(false); setBindingCode(null); }} code={bindingCode}/>

      <CreatePlayerModal open={showCreatePlayerModal} onClose={() => setShowCreatePlayerModal(false)} onSubmit={handleCreatePlayer}/>
      <PasswordModal open={showPlayerPasswordModal} onClose={() => { setShowPlayerPasswordModal(false); setEditPlayerTarget(null); }} onVerify={handlePlayerPasswordVerify} sessionId={editPlayerTarget?.id}/>
      <EditPlayerModal open={showEditPlayerModal} onClose={() => { setShowEditPlayerModal(false); setEditPlayerTarget(null); }} player={editPlayerTarget} onSave={handleSavePlayer} onDelete={handleDeletePlayer}/>

      {showToast && (
        <div style={{ position: "fixed", bottom: 96, left: "50%", transform: "translateX(-50%)", padding: "14px 24px", borderRadius: 14, background: showToast.type === "warn" ? "rgba(245,158,11,0.95)" : "rgba(34,197,94,0.95)", color: "#fff", fontSize: 13, fontWeight: 700, zIndex: 999, animation: "toastIn 0.3s ease", boxShadow: showToast.type === "warn" ? "0 8px 32px rgba(245,158,11,0.4)" : "0 8px 32px rgba(34,197,94,0.4)", maxWidth: "90vw", textAlign: "center", lineHeight: 1.5, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>{showToast.type === "warn" ? "⚠️" : "✅"}</span>
          <span>{showToast.msg}</span>
        </div>
      )}
    </div>
  );
}
