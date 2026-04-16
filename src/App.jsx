import { useState, useEffect, useRef } from "react";

// Helper to get date string offset from today
function dayOffset(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
const D0 = dayOffset(0), D1 = dayOffset(1), D2 = dayOffset(2), D3 = dayOffset(3);

const INITIAL_COURTS = [];

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

/* ── Shared styles ── */
const inputStyle = { width: "100%", padding: "10px 14px", borderRadius: 10, background: "rgba(15,23,42,0.8)", border: "1px solid rgba(148,163,184,0.15)", color: "#e2e8f0", fontSize: 14, outline: "none", transition: "border-color 0.2s", fontFamily: "inherit" };
const labelStyle = { fontSize: 12, color: "#94a3b8", marginBottom: 6, display: "block", fontWeight: 600, letterSpacing: "0.04em" };

/* ── Progress Ring ── */
const ProgressRing = ({ current, min, max }) => {
  const radius = 28, stroke = 4, nr = radius - stroke, circ = nr * 2 * Math.PI;
  const offset = circ - Math.min(current / max, 1) * circ;
  const minOffset = circ - (min / max) * circ;
  const status = getStatus({ registered: current, min, max });
  return (
    <div style={{ position: "relative", width: radius*2, height: radius*2, flexShrink: 0 }}>
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
const SessionCard = ({ session, courtName, area, onJoin, onEdit }) => {
  const status = getStatus(session);
  const need = Math.max(0, session.min - session.registered);
  const isFull = session.registered >= session.max;
  const isFormed = session.registered >= session.min;
  return (
    <div style={{ background: "var(--card-bg)", borderRadius: 16, padding: "20px 22px", border: "1px solid var(--border)", position: "relative", overflow: "hidden", transition: "all 0.25s ease" }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = status.color; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 8px 24px ${status.bg}`; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: status.color, opacity: 0.7 }}/>
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
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 13, color: "var(--text-secondary)", marginBottom: 10 }}>
            <span>📍 {area}</span><span>🕐 {session.time} 開始</span><span>🏐 {session.level}</span><span>💰 ${session.fee}/人</span><span>👤 主揪：{session.host}</span>
          </div>
          {session.notes && <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8, fontStyle: "italic" }}>📝 {session.notes}</div>}
          {session.signupUrl && <div style={{ fontSize: 11, marginBottom: 8, color: "#64748b", display: "flex", alignItems: "center", gap: 4 }}>🔗 點擊報名按鈕將前往外部報名頁面</div>}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            {!isFormed && !isFull && <span style={{ fontSize: 13, color: status.color, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}><PersonIcon/> 還差 {need} 人成團</span>}
            {isFormed && !isFull && <span style={{ fontSize: 13, color: "#22c55e", fontWeight: 500 }}>✅ 已成團，還可加入 {session.max - session.registered} 人</span>}
            {isFull && <span style={{ fontSize: 13, color: "#94a3b8" }}>已額滿</span>}
            {!isFull && (
              <button onClick={() => { if (session.signupUrl) { window.open(session.signupUrl, "_blank", "noopener,noreferrer"); } onJoin(session.id); }}
                style={{ padding: "7px 20px", borderRadius: 10, border: "none", background: isFormed ? "rgba(34,197,94,0.12)" : `linear-gradient(135deg, ${status.color}, ${status.color}dd)`, color: isFormed ? "#22c55e" : "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.2s ease" }}
                onMouseEnter={(e) => { e.target.style.transform = "scale(1.04)"; }}
                onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; }}
              >{isFormed ? "+ 我要加入" : "🙋 我要報名"}{session.signupUrl ? " ↗" : ""}</button>
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
   Edit Session Modal (all fields)
   ════════════════════════════════════════════ */
const EditSessionModal = ({ open, onClose, session, courtName, area, onSave }) => {
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

            <F label="報名連結（選填）" field="signupUrl" placeholder="https://..." />
            <span style={{ fontSize: 11, color: "#64748b", marginTop: -10 }}>貼上 FB 社團、LINE 群組或其他報名頁面的網址</span>

            <F label="備註（選填）" field="notes" type="textarea" placeholder="例：需自備球鞋..."/>

            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button onClick={onClose} style={{ flex: 1, padding: "14px", borderRadius: 14, border: "1px solid rgba(148,163,184,0.2)", background: "transparent", color: "#94a3b8", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>取消</button>
              <button onClick={handleSave}
                style={{ flex: 2, padding: "14px", borderRadius: 14, border: "none", background: "linear-gradient(135deg, #f59e0b, #f97316)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={(e) => { e.target.style.transform = "scale(1.02)"; e.target.style.boxShadow = "0 4px 20px rgba(245,158,11,0.3)"; }}
                onMouseLeave={(e) => { e.target.style.transform = "scale(1)"; e.target.style.boxShadow = "none"; }}
              >💾 儲存變更</button>
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
                <input value={form.signupUrl} onChange={(e) => setForm({...form, signupUrl: e.target.value})} placeholder="例：https://www.facebook.com/groups/..." style={inputStyle} onFocus={(e)=>{e.target.style.borderColor="#f59e0b";}} onBlur={(e)=>{e.target.style.borderColor="rgba(148,163,184,0.15)";}}/>
                <span style={{ fontSize: 11, color: "#64748b", marginTop: 4, display: "block" }}>貼上 FB 社團、LINE 群組或其他報名頁面的網址</span>
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
  const [courts, setCourts] = useState(INITIAL_COURTS);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // { session, courtName, area }
  const nextId = useRef(100);

  const toast = (msg, duration = 2500, type = "success") => { setShowToast({ msg, type }); setTimeout(() => setShowToast(null), duration); };

  const handleJoin = (sessionId) => {
    if (joinedSessions.has(sessionId)) return;
    const nj = new Set(joinedSessions); nj.add(sessionId); setJoinedSessions(nj);
    setCourts(prev => prev.map(c => ({...c, sessions: c.sessions.map(s => s.id === sessionId ? {...s, registered: s.registered + 1} : s)})));
    toast("請記得到主揪的報名頁面 +1，待主揪與您確認後才算報名成功喔！", 4000, "warn");
  };

  const handleCreateSession = (data) => {
    const ns = { id: `new_${nextId.current++}`, time: data.time, date: data.date, registered: data.registered, max: data.max, min: data.min, level: data.level, fee: data.fee, host: data.host, signupUrl: data.signupUrl, notes: data.notes, password: data.password };
    setCourts(prev => {
      const idx = prev.findIndex(c => c.name === data.courtName && c.area === data.area);
      if (idx >= 0) { const u = [...prev]; u[idx] = {...u[idx], sessions: [...u[idx].sessions, ns]}; return u; }
      return [...prev, { id: nextId.current++, name: data.courtName, area: data.area, sessions: [ns] }];
    });
    if (!AREAS_FILTER.includes(data.area)) AREAS_FILTER.push(data.area);
    setShowCreateModal(false);
    setSelectedDate(data.date);
    toast("場次已發佈！等待球友加入 🎉");
  };

  // Find session + court info by session id
  const findSessionInfo = (sessionId) => {
    for (const c of courts) {
      const s = c.sessions.find(s => s.id === sessionId);
      if (s) return { session: s, courtName: c.name, area: c.area };
    }
    return null;
  };

  const handleEditClick = (session) => {
    // find full session from courts (with password)
    const info = findSessionInfo(session.id);
    if (!info) return;
    setEditTarget(info);
    setShowPasswordModal(true);
  };

  const handlePasswordVerify = (sessionId, pw) => {
    const info = findSessionInfo(sessionId);
    if (!info) return false;
    if (info.session.password !== pw) return false;
    // password correct → close password modal, open edit modal
    setShowPasswordModal(false);
    setShowEditModal(true);
    return true;
  };

  const handleSaveEdit = (sessionId, data) => {
    setCourts(prev => {
      let updated = prev.map(c => {
        const sIdx = c.sessions.findIndex(s => s.id === sessionId);
        if (sIdx < 0) return c;
        const oldSession = c.sessions[sIdx];
        const newSession = { ...oldSession, time: data.time, date: data.date, registered: data.registered, max: data.max, level: data.level, fee: data.fee, host: data.host, signupUrl: data.signupUrl, notes: data.notes };
        // If court name or area changed, remove from here and add elsewhere
        if (data.courtName !== c.name || data.area !== c.area) {
          const newSessions = c.sessions.filter(s => s.id !== sessionId);
          return { ...c, sessions: newSessions, _movedSession: newSession, _newCourtName: data.courtName, _newArea: data.area };
        }
        const newSessions = [...c.sessions]; newSessions[sIdx] = newSession;
        return { ...c, sessions: newSessions };
      });

      // Handle moved sessions
      const moved = updated.find(c => c._movedSession);
      if (moved) {
        const ms = moved._movedSession;
        const cn = moved._newCourtName, ca = moved._newArea;
        updated = updated.map(c => { const { _movedSession, _newCourtName, _newArea, ...rest } = c; return rest; });
        // remove empty courts
        updated = updated.filter(c => c.sessions.length > 0);
        const targetIdx = updated.findIndex(c => c.name === cn && c.area === ca);
        if (targetIdx >= 0) {
          updated[targetIdx] = { ...updated[targetIdx], sessions: [...updated[targetIdx].sessions, ms] };
        } else {
          updated.push({ id: nextId.current++, name: cn, area: ca, sessions: [ms] });
        }
      }

      return updated;
    });

    if (!AREAS_FILTER.includes(data.area)) AREAS_FILTER.push(data.area);
    setShowEditModal(false);
    setEditTarget(null);
    toast("場次已更新 ✅");
  };

  const allSessions = courts.flatMap(c =>
    c.sessions.filter(s => s.date === selectedDate).filter(s => selectedArea === "全部" || c.area === selectedArea).filter(s => selectedLevel === "全部" || s.level === selectedLevel).map(s => ({...s, courtName: c.name, area: c.area}))
  );
  const sorted = [...allSessions].sort((a,b) => { if (sortBy === "need") return getStatusPriority(a) - getStatusPriority(b); if (sortBy === "time") return a.time.localeCompare(b.time); if (sortBy === "fee") return a.fee - b.fee; return 0; });
  const totalPlayers = allSessions.reduce((sum,s) => sum + s.registered, 0);
  const needPeople = allSessions.filter(s => s.registered < s.min);
  const formed = allSessions.filter(s => s.registered >= s.min && s.registered < s.max);

  return (
    <div style={{ "--text-primary": "#e2e8f0", "--text-secondary": "#94a3b8", "--text-dim": "#64748b", "--card-bg": "rgba(15,23,42,0.6)", "--border": "rgba(148,163,184,0.1)", "--surface": "rgba(15,23,42,0.4)", minHeight: "100vh", background: "linear-gradient(160deg, #0c1222 0%, #0f172a 40%, #14102a 100%)", color: "var(--text-primary)", fontFamily: "'Noto Sans TC', 'Noto Sans', -apple-system, sans-serif", padding: "0 0 100px", position: "relative" }}>
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
        input[type="number"]::-webkit-inner-spin-button, input[type="number"]::-webkit-outer-spin-button { opacity: 1; }
      `}</style>

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
          {DATES.map(d => (
            <button key={d.value} onClick={() => setSelectedDate(d.value)} style={{ padding: "8px 20px", borderRadius: 10, border: "1px solid", borderColor: selectedDate === d.value ? "#f59e0b" : "var(--border)", background: selectedDate === d.value ? "rgba(245,158,11,0.12)" : "transparent", color: selectedDate === d.value ? "#f59e0b" : "var(--text-secondary)", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}>
              {d.label}<span style={{ fontSize: 11, opacity: 0.6, marginLeft: 4 }}>{d.value.slice(5).replace("-","/")}</span>
            </button>
          ))}
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
          {sorted.length === 0 && (
            <div style={{ textAlign: "center", padding: 48, color: "var(--text-dim)", fontSize: 14 }}>
              這個時段目前沒有場次，試試其他日期或地區 🏐<br/>
              <button onClick={() => setShowCreateModal(true)} style={{ marginTop: 16, padding: "10px 24px", borderRadius: 12, border: "1px dashed rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.06)", color: "#f59e0b", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ 自己開一場</button>
            </div>
          )}
          {sorted.map((s, i) => (
            <div key={s.id} style={{ animation: `slideUp 0.4s ease ${i * 0.06}s both` }}>
              <SessionCard session={s} courtName={s.courtName} area={s.area} onJoin={handleJoin} onEdit={handleEditClick}/>
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

      <EditSessionModal open={showEditModal} onClose={() => { setShowEditModal(false); setEditTarget(null); }} session={editTarget?.session} courtName={editTarget?.courtName} area={editTarget?.area} onSave={handleSaveEdit}/>

      {showToast && (
        <div style={{ position: "fixed", bottom: 96, left: "50%", transform: "translateX(-50%)", padding: "14px 24px", borderRadius: 14, background: showToast.type === "warn" ? "rgba(245,158,11,0.95)" : "rgba(34,197,94,0.95)", color: "#fff", fontSize: 13, fontWeight: 700, zIndex: 999, animation: "toastIn 0.3s ease", boxShadow: showToast.type === "warn" ? "0 8px 32px rgba(245,158,11,0.3)" : "0 8px 32px rgba(34,197,94,0.3)", maxWidth: "90vw", textAlign: "center", lineHeight: 1.5 }}>{showToast.msg}</div>
      )}
    </div>
  );
}
