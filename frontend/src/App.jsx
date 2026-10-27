import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, Check, ChevronDown, Clock3, LogIn, LogOut, MapPin, Plus, ShieldCheck, Trash2, UserRound, Users, X } from "lucide-react";

const statuses = [
  { value: "present", label: "Présent", className: "yes" },
  { value: "maybe", label: "Peut-être", className: "maybe" },
  { value: "absent", label: "Absent", className: "no" }
];

const dateLabel = (value, timezone = "Europe/Paris") => new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: timezone }).format(new Date(value));
const timeLabel = (value, timezone = "Europe/Paris") => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(value));
const apiBase = `${import.meta.env.BASE_URL}api`;
const zonedDateParts = (date, timezone) => new Intl.DateTimeFormat("en-CA", {
  timeZone: timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
}).formatToParts(date).reduce((parts, part) => ({ ...parts, [part.type]: part.value }), {});

const localInputValue = (date, timezone) => {
  const parts = zonedDateParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

const localDateTimeToIso = (value, timezone) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Choisissez une date et une heure valides.");
  const [, year, month, day, hour, minute] = match;
  const targetUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const zoned = zonedDateParts(new Date(targetUtc), timezone);
  const displayedUtc = Date.UTC(Number(zoned.year), Number(zoned.month) - 1, Number(zoned.day), Number(zoned.hour), Number(zoned.minute));
  return new Date(targetUtc - (displayedUtc - targetUtc)).toISOString();
};

async function api(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (response.status === 204) return null;
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "La requête a échoué.");
  return payload;
}

function BadmintonMark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="22" cy="27" rx="11" ry="15" transform="rotate(35 22 27)" strokeWidth="2.8" />
        <path d="m29 38 14 14m-17-12 13-11M18 15l13 22m-14-13 18 11m-20-3 15 9" strokeWidth="1.5" />
        <path d="m40 10 14 6-7 16-8-1-5-7 6-14Z" fill="currentColor" fillOpacity=".16" strokeWidth="2.5" />
        <path d="m40 10 7 22m7-16-20 8" strokeWidth="1.5" />
        <path d="m43 52 8 7" strokeWidth="4" />
      </g>
      <circle cx="40" cy="10" r="3" fill="currentColor" />
    </svg>
  );
}

function App() {
  const [sessions, setSessions] = useState([]);
  const [members, setMembers] = useState([]);
  const [coach, setCoach] = useState(null);
  const [demoMode, setDemoMode] = useState(false);
  const [allowRealNames, setAllowRealNames] = useState(false);
  const [timezone, setTimezone] = useState("Europe/Paris");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedMember, setSelectedMember] = useState("");
  const [responsesBySession, setResponsesBySession] = useState({});
  const [activeTab, setActiveTab] = useState("sessions");
  const [attendance, setAttendance] = useState([]);
  const [publicAttendance, setPublicAttendance] = useState({});
  const [expandedSession, setExpandedSession] = useState(null);
  const [stats, setStats] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [sessionForm, setSessionForm] = useState({ startsAt: "", endsAt: "", location: "", coach: "" });
  const [memberName, setMemberName] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);

  const loadPublicData = useCallback(async () => {
    const [sessionData, memberData] = await Promise.all([api("/sessions"), api("/members")]);
    setSessions(sessionData.sessions);
    setMembers(memberData.members);
    setSelectedMember((current) => current && memberData.members.some((member) => String(member.id) === current) ? current : "");
  }, []);

  const loadCoachData = useCallback(async () => {
    try {
      const { demoMode: isDemo, allowRealNames: canRegisterNames, timezone: clubTimezone } = await api("/config");
      setDemoMode(isDemo);
      setAllowRealNames(canRegisterNames);
      setTimezone(clubTimezone);
      if (isDemo) {
        setCoach(null);
        return;
      }
      const { coach: currentCoach } = await api("/auth/me");
      setCoach(currentCoach);
    } catch (requestError) {
      if (requestError.message !== "Connexion entraîneur requise." && !requestError.message.startsWith("Session expirée")) throw requestError;
      setCoach(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    setError("");
    try {
      await Promise.all([loadPublicData(), loadCoachData()]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [loadCoachData, loadPublicData]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!coach) return;
    if (activeTab === "stats") {
      api("/stats").then(setStats).catch((requestError) => setError(requestError.message));
    } else if (activeTab === "manage" && sessions[0]) {
      api(`/sessions/${sessions[0].id}/attendance`).then((data) => setAttendance(data.attendance)).catch((requestError) => setError(requestError.message));
    }
  }, [activeTab, coach, sessions]);

  const upcoming = useMemo(() => sessions.filter((session) => new Date(session.ends_at) >= new Date()), [sessions]);

  async function submitResponse(sessionId, response) {
    if (!selectedMember) {
      setError("Choisissez votre nom avant de répondre.");
      return;
    }
    setError("");
    try {
      await api(`/sessions/${sessionId}/attendance`, { method: "PUT", body: { memberId: Number(selectedMember), response } });
      setResponsesBySession((current) => ({ ...current, [`${sessionId}:${selectedMember}`]: response }));
      setNotice("Votre réponse a bien été enregistrée.");
      await loadPublicData();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function submitLogin(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError("");
    try {
      await api("/auth/login", { method: "POST", body: { email: data.get("email"), password: data.get("password") } });
      await loadCoachData();
      setLoginOpen(false);
      setActiveTab("manage");
      setNotice("Bienvenue dans votre espace entraîneur.");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
      setCoach(null);
      setActiveTab("sessions");
      setNotice("Vous êtes déconnecté.");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function prepareEdit(session) {
    setEditingId(session.id);
    setSessionForm({ startsAt: localInputValue(new Date(session.starts_at), timezone), endsAt: localInputValue(new Date(session.ends_at), timezone), location: session.location, coach: session.coach });
  }

  async function saveSession(event) {
    event.preventDefault();
    setError("");
    try {
      const path = editingId ? `/sessions/${editingId}` : "/sessions";
      const body = {
        ...sessionForm,
        startsAt: localDateTimeToIso(sessionForm.startsAt, timezone),
        endsAt: localDateTimeToIso(sessionForm.endsAt, timezone)
      };
      await api(path, { method: editingId ? "PATCH" : "POST", body });
      setEditingId(null);
      setSessionForm({ startsAt: "", endsAt: "", location: "", coach: "" });
      setNotice(editingId ? "Séance modifiée." : "Nouvelle séance créée.");
      await loadPublicData();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function removeSession(id) {
    if (!window.confirm("Supprimer cette séance et toutes ses réponses ?")) return;
    try {
      await api(`/sessions/${id}`, { method: "DELETE" });
      setNotice("Séance supprimée.");
      await loadPublicData();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function addMember(event) {
    event.preventDefault();
    try {
      await api("/members", { method: "POST", body: { name: memberName } });
      setMemberName("");
      setNotice("Membre ajouté.");
      await loadPublicData();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function registerMember(event) {
    event.preventDefault();
    setError("");
    try {
      const { member } = await api("/members/register", { method: "POST", body: { name: newMemberName } });
      setNewMemberName("");
      setSelectedMember(String(member.id));
      setNotice(`Bienvenue ${member.name} ! Choisissez votre réponse pour les séances.`);
      await loadPublicData();
      setSelectedMember(String(member.id));
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function removeMember(id, name) {
    if (!window.confirm(`Supprimer ${name} et ses réponses ?`)) return;
    try {
      await api(`/members/${id}`, { method: "DELETE" });
      setNotice("Membre supprimé.");
      await loadPublicData();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function showAttendance(sessionId) {
    try {
      const data = await api(`/sessions/${sessionId}/attendance`);
      setAttendance(data.attendance);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function togglePublicAttendance(sessionId) {
    if (expandedSession === sessionId) {
      setExpandedSession(null);
      return;
    }
    try {
      const data = await api(`/sessions/${sessionId}/attendance`);
      setPublicAttendance((current) => ({ ...current, [sessionId]: data.attendance }));
      setExpandedSession(sessionId);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  if (loading) return <div className="loading-screen"><span className="loader" />Chargement du club…</div>;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={() => setActiveTab("sessions")}>
          <span className="brand-mark"><BadmintonMark size={24} /></span>
          <span>volant<span className="brand-dot">.</span><small>CLUB DE BADMINTON</small></span>
        </a>
        <div className="top-actions">
          <span className="club-status"><i /> Club ouvert</span>
          {demoMode
            ? <span className="demo-badge">Démo · données fictives</span>
            : coach
            ? <button className="text-button" onClick={logout}><LogOut size={16} /> Déconnexion</button>
            : <button className="coach-button" onClick={() => setLoginOpen(true)}><ShieldCheck size={16} /> Espace entraîneur</button>}
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span /> LA VIE DU CLUB, TOUT SIMPLEMENT</div>
            <h1>On se retrouve<br />sur le <em>terrain.</em></h1>
            <p>Les prochaines séances, les réponses de chacun —<br className="desktop-break" /> tout ce qu’il faut pour jouer ensemble.</p>
            <a className="hero-link" href="#sessions">Voir les prochaines séances <ArrowDownRight size={17} /></a>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className="hero-circle"><BadmintonMark size={78} /></div>
            <span className="float-tag tag-one"><span className="mini-dot" /> On joue ?</span>
            <span className="float-tag tag-two"><Users size={15} /> Tous niveaux</span>
            <span className="hero-spark">✳</span>
          </div>
        </section>

        {error && <div className="feedback error-feedback" role="alert">{error}<button onClick={() => setError("")}><X size={15} /></button></div>}
        {notice && <div className="feedback success-feedback" role="status"><Check size={16} />{notice}<button onClick={() => setNotice("")}><X size={15} /></button></div>}

        <section className="sessions-section" id="sessions">
          <div className="section-heading">
            <div><div className="eyebrow"><span /> À VENIR</div><h2>Les prochaines séances<span className="heading-period">.</span></h2></div>
            <div className="member-picker">
              <span>Je suis</span>
              <label className="select-wrap">
                <select value={selectedMember} onChange={(event) => setSelectedMember(event.target.value)} aria-label="Choisir votre nom">
                  <option value="">Choisir mon nom</option>
                  {members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}
                </select>
                <ChevronDown size={15} />
              </label>
            </div>
          </div>
          {allowRealNames && <form className="self-register-form" onSubmit={registerMember}>
            <span>Pas encore dans la liste ? Votre nom sera visible par les autres membres avec votre réponse.</span>
            <input value={newMemberName} maxLength="100" autoComplete="name" placeholder="Saisissez votre prénom et nom" required onChange={(event) => setNewMemberName(event.target.value)} />
            <button type="submit">M’inscrire <Plus size={15} /></button>
          </form>}

          {upcoming.length ? <div className="session-grid">
            {upcoming.map((session, index) => <article className="session-card" key={session.id}>
              <div className={`card-accent accent-${index % 3}`} />
              <div className="session-topline"><span className="session-kicker"><CalendarDays size={14} /> SÉANCE CLUB</span><span className="session-index">N° {String(index + 1).padStart(2, "0")}</span></div>
              <h3>{dateLabel(session.starts_at, timezone)}</h3>
              <div className="session-detail"><Clock3 size={15} /><span>{timeLabel(session.starts_at, timezone)} — {timeLabel(session.ends_at, timezone)}</span></div>
              <div className="session-detail"><MapPin size={15} /><span>{session.location}</span></div>
              <div className="session-detail"><UserRound size={15} /><span>{session.coach}</span></div>
              <div className="attendance-counts">
                <span className="count-yes"><i /> {session.present_count} présent{session.present_count > 1 ? "s" : ""}</span>
                <span className="count-maybe">{session.maybe_count} incertain{session.maybe_count > 1 ? "s" : ""}</span>
              </div>
              <button className="attendance-toggle" onClick={() => togglePublicAttendance(session.id)}>{expandedSession === session.id ? "Masquer les réponses" : "Voir les réponses"} <ChevronDown size={13} /></button>
              {expandedSession === session.id && <div className="public-attendance">
                {publicAttendance[session.id]?.filter((person) => person.response).length
                  ? publicAttendance[session.id].filter((person) => person.response).map((person) => <div key={person.id}><span>{person.name}</span><span className={`status-chip ${person.response}`}>{statuses.find((item) => item.value === person.response)?.label}</span></div>)
                  : <span className="subtle-text">Pas encore de réponse.</span>}
              </div>}
              <div className="response-divider" />
              <p className="response-label">Tu viens ?</p>
              <div className="response-actions">
                {statuses.map((status) => <button key={status.value} className={`response-button ${status.className} ${responsesBySession[`${session.id}:${selectedMember}`] === status.value ? "selected" : ""}`} onClick={() => submitResponse(session.id, status.value)} disabled={!selectedMember}>{status.label}</button>)}
              </div>
              {coach && <div className="card-admin-actions"><button onClick={() => prepareEdit(session)}>Modifier</button><button onClick={() => removeSession(session.id)}>Supprimer</button></div>}
            </article>)}
          </div> : <div className="empty-state"><div className="empty-icon"><CalendarDays /></div><h3>Pas encore de séance prévue</h3><p>Les prochaines dates apparaîtront ici dès qu’elles seront ajoutées.</p>{coach && <button className="primary-button" onClick={() => { setActiveTab("manage"); document.getElementById("coach-panel")?.scrollIntoView({ behavior: "smooth" }); }}>Ajouter une séance <Plus size={16} /></button>}</div>}
        </section>

        {coach && <section className="coach-panel" id="coach-panel">
          <div className="coach-heading">
            <div><div className="eyebrow"><span /> ESPACE ENTRAÎNEUR</div><h2>Gestion du club<span className="heading-period">.</span></h2></div>
            <div className="tab-list">
              <button className={activeTab === "manage" ? "active" : ""} onClick={() => setActiveTab("manage")}>Gestion</button>
              <button className={activeTab === "stats" ? "active" : ""} onClick={() => setActiveTab("stats")}>Statistiques</button>
            </div>
          </div>
          {activeTab === "stats" ? <div className="stats-content">
            <div className="stat-grid">
              <StatCard label="Séances passées" value={stats?.summary.sessions_count ?? "—"} icon={<CalendarDays />} />
              <StatCard label="Présences enregistrées" value={stats?.summary.present_count ?? "—"} icon={<Check />} />
              <StatCard label="Réponses incertaines" value={stats?.summary.maybe_count ?? "—"} icon={<ArrowUpRight />} />
              <StatCard label="Absences signalées" value={stats?.summary.absent_count ?? "—"} icon={<ArrowDownRight />} />
            </div>
            <div className="ranking"><h3>Présences par membre</h3>{stats?.members?.length ? stats.members.map((member, index) => <div className="ranking-row" key={member.id}><span className="rank-number">{String(index + 1).padStart(2, "0")}</span><span>{member.name}</span><strong>{member.attended_count} séance{member.attended_count > 1 ? "s" : ""}</strong></div>) : <p className="subtle-text">Les statistiques apparaîtront après les premières séances.</p>}</div>
          </div> : <div className="manage-grid">
            <div className="manage-box">
              <h3>{editingId ? "Modifier la séance" : "Planifier une séance"}</h3>
              <form className="session-form" onSubmit={saveSession}>
                <label>Date et heure de début<input type="datetime-local" value={sessionForm.startsAt} required onChange={(e) => setSessionForm({ ...sessionForm, startsAt: e.target.value })} /></label>
                <label>Date et heure de fin<input type="datetime-local" value={sessionForm.endsAt} required onChange={(e) => setSessionForm({ ...sessionForm, endsAt: e.target.value })} /></label>
                <label>Lieu<input value={sessionForm.location} maxLength="160" placeholder="Ex. Gymnase municipal" required onChange={(e) => setSessionForm({ ...sessionForm, location: e.target.value })} /></label>
                <label>Entraîneur<input value={sessionForm.coach} maxLength="100" placeholder="Nom de l’entraîneur" required onChange={(e) => setSessionForm({ ...sessionForm, coach: e.target.value })} /></label>
                <div className="form-actions"><button className="primary-button" type="submit">{editingId ? "Enregistrer" : "Créer la séance"} <Plus size={15} /></button>{editingId && <button className="cancel-button" type="button" onClick={() => { setEditingId(null); setSessionForm({ startsAt: "", endsAt: "", location: "", coach: "" }); }}>Annuler</button>}</div>
              </form>
            </div>
            <div className="manage-box">
              <h3>Les membres <span className="small-count">{members.length}</span></h3>
              <form className="member-form" onSubmit={addMember}><input value={memberName} maxLength="100" placeholder="Nom du membre" required onChange={(e) => setMemberName(e.target.value)} /><button className="add-button" aria-label="Ajouter un membre"><Plus size={18} /></button></form>
              {members.length ? <div className="member-list">{members.map((member) => <div className="member-row" key={member.id}><span className="avatar">{member.name.trim().charAt(0).toUpperCase()}</span><span>{member.name}</span><button aria-label={`Supprimer ${member.name}`} onClick={() => removeMember(member.id, member.name)}><Trash2 size={15} /></button></div>)}</div> : <p className="subtle-text">Ajoutez des membres pour qu’ils puissent répondre aux séances.</p>}
              <h3 className="attendance-title">Réponses à une séance</h3>
              {sessions.length ? <label className="attendance-select">Choisir une séance<select onChange={(e) => showAttendance(e.target.value)} defaultValue={sessions[0].id}>{sessions.map((session) => <option key={session.id} value={session.id}>{dateLabel(session.starts_at, timezone)} · {session.coach}</option>)}</select></label> : <p className="subtle-text">Aucune séance à afficher.</p>}
              {attendance.map((person) => <div className="attendance-row" key={person.id}><span>{person.name}</span><span className={`status-chip ${person.response || "unanswered"}`}>{person.response ? statuses.find((item) => item.value === person.response)?.label : "Sans réponse"}</span></div>)}
            </div>
          </div>}
        </section>}

        <section className="bottom-note"><div className="note-icon"><Users size={18} /></div><p>{demoMode ? <>Démonstration avec des joueurs fictifs.<br /><span>N’utilisez aucune donnée réelle de membre sur cet hébergement.</span></> : <>Une question sur les séances ?<br /><span>Rapprochez-vous de l’entraîneur au prochain entraînement.</span></>}</p><ArrowUpRight size={18} /></section>
      </main>
      <footer><span>volant<span className="brand-dot">.</span> <small>LE PLAISIR DE JOUER ENSEMBLE</small></span><span>© {new Date().getFullYear()} — Votre club de badminton</span></footer>

      {loginOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setLoginOpen(false); }}>
        <form className="login-modal" onSubmit={submitLogin}>
          <button type="button" className="modal-close" aria-label="Fermer" onClick={() => setLoginOpen(false)}><X size={19} /></button>
          <div className="modal-symbol"><ShieldCheck size={22} /></div><div className="eyebrow"><span /> ACCÈS RÉSERVÉ</div>
          <h2>Espace entraîneur</h2><p>Connectez-vous pour gérer les séances et suivre le club.</p>
          <label>Adresse e-mail<input name="email" type="email" autoComplete="username" required /></label>
          <label>Mot de passe<input name="password" type="password" autoComplete="current-password" required /></label>
          <button className="primary-button login-submit" type="submit"><LogIn size={16} /> Se connecter</button>
        </form>
      </div>}
    </div>
  );
}

function StatCard({ label, value, icon }) {
  return <div className="stat-card"><div className="stat-icon">{icon}</div><span>{label}</span><strong>{value}</strong></div>;
}

export default App;
