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
// Helper to get date string offset from today
function dayOffset(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

const AREAS_FILTER = ["全部", "大安區", "信義區", "中山區", "松山區", "內湖區", "文山區", "北投區", "士林區"];
const LEVELS = ["全部", "初階", "中階", "中高階", "不限"];
const LEVELS_INPUT = ["初階", "中階", "中高階", "不限"];

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
                    style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(148,163,184,0.2)", background: "rgba(15,23,42,0.8)", color: "#e2e8f0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  ><MinusIcon/></button>
                  <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, color: "#e2e8f0", minWidth: 20, textAlign: "center" }}>{session.registered}</span>
                  <button onClick={() => onAdminAdjust(session.id, "registered", 1)}
                    style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(148,163,184,0.2)", background: "rgba(15,23,42,0.8)", color: "#e2e8f0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  ><PlusSmallIcon/></button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#94a3b8" }}>
                  <span>候補：</span>
                  <button onClick={() => onAdminAdjust(session.id, "waitlist", -1)}
                    style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(148,163,184,0.2)", background: "rgba(15,23,42,0.8)", color: "#e2e8f0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  ><MinusIcon/></button>
                  <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, color: "#e2e8f0", minWidth: 20, textAlign: "center" }}>{session.waitlist || 0}</span>
                  <button onClick={() => onAdminAdjust(session.id, "waitlist", 1)}
                    style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(148,163,184,0.2)", background: "rgba(15,23,42,0.8)", color: "#e2e8f0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
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
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: commentCount > 0 ? "#60a5fa" : "#64748b", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, width: "100%", justifyContent: "space-between" }}
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

const StatBadge = ({ value, label, color }) => (
  <div style={{ textAlign: "center", padding: "12px 16px", borderRadius: 12, background: `${color}0a`, border: `1px solid ${color}18`, minWidth: 80 }}>
    <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "'Space Mono', monospace" }}>{value}</div>
    <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2, letterSpacing: "0.04em" }}>{label}</div>
  </div>
);

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
   Edit Session Modal (all fields)
   ════════════════════════════════════════════ */
const EditSessionModal = ({ open, onClose, session, courtName, area, onSave, onCloseSession }) => {
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
const CreateSessionModal = ({ open, onClose, onSubmit }) => {
  const [form, setForm] = useState({ courtName: "", area: "", date: getToday(), startTime: "19:00", currentPeople: "1", maxPeople: "16", level: "中階", fee: "", hostName: "", signupUrl: "", notes: "", password: "" });
  const [errors, setErrors] = useState({});
  const [step, setStep] = useState(1);

  const handleSubmit = () => {
    const e = {};
    if (!form.fee || Number(form.fee) <= 0) e.fee = "請輸入費用";
    if (Number(form.currentPeople) < 1) e.currentPeople = "至少要有1人";
    if (Number(form.maxPeople) < 12) e.maxPeople = "上限至少12人";
    if (Number(form.currentPeople) > Number(form.maxPeople)) e.currentPeople = "不能超過上限人數";
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    onSubmit({ courtName: form.courtName.trim(), area: form.area.trim(), date: form.date, time: form.startTime, registered: Number(form.currentPeople), max: Number(form.maxPeople), min: 12, level: form.level, fee: Number(form.fee), host: form.hostName.trim(), signupUrl: form.signupUrl.trim(), notes: form.notes.trim(), password: form.password });
    setForm({ courtName: "", area: "", date: getToday(), startTime: "19:00", currentPeople: "1", maxPeople: "16", level: "中階", fee: "", hostName: "", signupUrl: "", notes: "", password: "" });
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

  const handleJoin = async (sessionId) => {
    if (joinedSessions.has(sessionId)) return;
    const nj = new Set(joinedSessions); nj.add(sessionId);
    setJoinedSessions(nj); saveJoined(nj);
    try {
      await updateDoc(doc(db, "sessions", sessionId), { registered: increment(1) });
      toast("請記得到主揪的報名頁面 +1，待主揪與您確認後才算報名成功喔！", 4000, "warn");
    } catch (err) {
      console.error(err);
      // Rollback on error
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
      toast("場次已發佈！等待球友加入 🎉");
    } catch (err) {
      console.error(err);
      toast("發佈失敗，請稍後再試", 3000, "warn");
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

      <div style={{ padding: "32px 24px 24px", background: "linear-gradient(180deg, rgba(15,23,42,0.9) 0%, transparent 100%)", borderBottom: "1px solid var(--border)", marginBottom: 20 }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <div style={{ color: "#f59e0b" }}><VolleyballIcon/></div>
            <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-0.02em", background: "linear-gradient(135deg, #f59e0b, #f97316)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>排球揪團雷達</h1>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>即時掌握台北各場館的排球場次，快速找到缺人的場，讓每一場都能順利開打</p>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 16px" }}>
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
          <div style={{ flex: 1, minWidth: 120 }}><label style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4, display: "block" }}>地區</label><select value={selectedArea} onChange={(e) => setSelectedArea(e.target.value)} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, background: "rgba(15,23,42,0.8)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: 13 }}>{AREAS_FILTER.map(a => <option key={a} value={a}>{a}</option>)}</select></div>
          <div style={{ flex: 1, minWidth: 120 }}><label style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4, display: "block" }}>程度</label><select value={selectedLevel} onChange={(e) => setSelectedLevel(e.target.value)} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, background: "rgba(15,23,42,0.8)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: 13 }}>{LEVELS.map(l => <option key={l} value={l}>{l}</option>)}</select></div>
          <div style={{ flex: 1, minWidth: 120 }}><label style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4, display: "block" }}>排序</label><select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, background: "rgba(15,23,42,0.8)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: 13 }}><option value="need">缺人優先</option><option value="time">時間排序</option><option value="fee">費用低→高</option></select></div>
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
      </div>

      <button onClick={() => setShowCreateModal(true)} style={{ position: "fixed", bottom: 24, right: 24, zIndex: 800, width: 60, height: 60, borderRadius: "50%", border: "none", background: "linear-gradient(135deg, #f59e0b, #f97316)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 24px rgba(245,158,11,0.4)", transition: "all 0.2s ease", animation: "glow 3s ease infinite" }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.1) rotate(90deg)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1) rotate(0deg)"; }}
      ><PlusIcon/></button>

      <CreateSessionModal open={showCreateModal} onClose={() => setShowCreateModal(false)} onSubmit={handleCreateSession}/>

      <PasswordModal open={showPasswordModal} onClose={() => { setShowPasswordModal(false); setEditTarget(null); }} onVerify={handlePasswordVerify} sessionId={editTarget?.session?.id}/>

      <EditSessionModal open={showEditModal} onClose={() => { setShowEditModal(false); setEditTarget(null); }} session={editTarget?.session} courtName={editTarget?.courtName} area={editTarget?.area} onSave={handleSaveEdit} onCloseSession={handleCloseSession}/>

      <CommentModal open={showCommentModal} onClose={() => { setShowCommentModal(false); setCommentTarget(null); }} session={commentTarget} onSubmit={handleAddComment}/>

      <AdminLoginModal open={showAdminLoginModal} onClose={() => setShowAdminLoginModal(false)} onLogin={handleAdminLogin}/>

      {showToast && (
        <div style={{ position: "fixed", bottom: 96, left: "50%", transform: "translateX(-50%)", padding: "14px 24px", borderRadius: 14, background: showToast.type === "warn" ? "rgba(245,158,11,0.95)" : "rgba(34,197,94,0.95)", color: "#fff", fontSize: 13, fontWeight: 700, zIndex: 999, animation: "toastIn 0.3s ease", boxShadow: showToast.type === "warn" ? "0 8px 32px rgba(245,158,11,0.3)" : "0 8px 32px rgba(34,197,94,0.3)", maxWidth: "90vw", textAlign: "center", lineHeight: 1.5 }}>{showToast.msg}</div>
      )}
    </div>
  );
}
