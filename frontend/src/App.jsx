import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, Check, ChevronDown, Clock3, Dumbbell, LogIn, LogOut, MapPin, Plus, ShieldCheck, Trash2, Users, X } from "lucide-react";

const statuses = [
  { value: "present", label: "Présent", className: "yes" },
  { value: "maybe", label: "Peut-être", className: "maybe" },
  { value: "absent", label: "Absent", className: "no" }
];

const dateLabel = (value) => new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date(value));
const timeLabel = (value) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const apiBase = `${import.meta.env.BASE_URL}api`;
const localInputValue = (date = new Date()) => {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
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

function App() {
  const [sessions, setSessions] = useState([]);
  const [members, setMembers] = useState([]);
  const [coach, setCoach] = useState(null);
  const [demoMode, setDemoMode] = useState(false);
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
  const [sessionForm, setSessionForm] = useState({ startsAt: "", endsAt: "", location: "" });
  const [memberName, setMemberName] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);

  const loadPublicData = useCallback(async () => {
    const [sessionData, memberData] = await Promise.all([api("/sessions"), api("/members")]);
    setSessions(sessionData.sessions);
    setMembers(memberData.members);
    setSelectedMember((current) => current && memberData.members.some((member) => String(member.id) === current)
      ? current
      : String(memberData.members[0]?.id || ""));
  }, []);

  const loadCoachData = useCallback(async () => {
    try {
      const { demoMode: isDemo } = await api("/config");
      setDemoMode(isDemo);
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
      setResponsesBySession((current) => ({ ...current, [sessionId]: response }));
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
    setSessionForm({ startsAt: localInputValue(new Date(session.starts_at)), endsAt: localInputValue(new Date(session.ends_at)), location: session.location });
  }

  async function saveSession(event) {
    event.preventDefault();
    setError("");
    try {
      const path = editingId ? `/sessions/${editingId}` : "/sessions";
      const body = {
        ...sessionForm,
        startsAt: new Date(sessionForm.startsAt).toISOString(),
        endsAt: new Date(sessionForm.endsAt).toISOString()
      };
      await api(path, { method: editingId ? "PATCH" : "POST", body });
      setEditingId(null);
      setSessionForm({ startsAt: "", endsAt: "", location: "" });
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
          <span className="brand-mark"><Dumbbell size={19} strokeWidth={2.2} /></span>
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
            <div className="hero-circle"><Dumbbell size={76} strokeWidth={1.3} /></div>
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
                  {!members.length && <option value="">Aucun membre</option>}
                  {members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}
                </select>
                <ChevronDown size={15} />
              </label>
            </div>
          </div>

          {upcoming.length ? <div className="session-grid">
            {upcoming.map((session, index) => <article className="session-card" key={session.id}>
              <div className={`card-accent accent-${index % 3}`} />
              <div className="session-topline"><span className="session-kicker"><CalendarDays size={14} /> SÉANCE CLUB</span><span className="session-index">N° {String(index + 1).padStart(2, "0")}</span></div>
              <h3>{dateLabel(session.starts_at)}</h3>
              <div className="session-detail"><Clock3 size={15} /><span>{timeLabel(session.starts_at)} — {timeLabel(session.ends_at)}</span></div>
              <div className="session-detail"><MapPin size={15} /><span>{session.location}</span></div>
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
                {statuses.map((status) => <button key={status.value} className={`response-button ${status.className} ${responsesBySession[session.id] === status.value ? "selected" : ""}`} onClick={() => submitResponse(session.id, status.value)} disabled={!members.length}>{status.label}</button>)}
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
                <div className="form-actions"><button className="primary-button" type="submit">{editingId ? "Enregistrer" : "Créer la séance"} <Plus size={15} /></button>{editingId && <button className="cancel-button" type="button" onClick={() => { setEditingId(null); setSessionForm({ startsAt: "", endsAt: "", location: "" }); }}>Annuler</button>}</div>
              </form>
            </div>
            <div className="manage-box">
              <h3>Les membres <span className="small-count">{members.length}</span></h3>
              <form className="member-form" onSubmit={addMember}><input value={memberName} maxLength="100" placeholder="Nom du membre" required onChange={(e) => setMemberName(e.target.value)} /><button className="add-button" aria-label="Ajouter un membre"><Plus size={18} /></button></form>
              {members.length ? <div className="member-list">{members.map((member) => <div className="member-row" key={member.id}><span className="avatar">{member.name.trim().charAt(0).toUpperCase()}</span><span>{member.name}</span><button aria-label={`Supprimer ${member.name}`} onClick={() => removeMember(member.id, member.name)}><Trash2 size={15} /></button></div>)}</div> : <p className="subtle-text">Ajoutez des membres pour qu’ils puissent répondre aux séances.</p>}
              <h3 className="attendance-title">Réponses à une séance</h3>
              {sessions.length ? <label className="attendance-select">Choisir une séance<select onChange={(e) => showAttendance(e.target.value)} defaultValue={sessions[0].id}>{sessions.map((session) => <option key={session.id} value={session.id}>{dateLabel(session.starts_at)} · {session.location}</option>)}</select></label> : <p className="subtle-text">Aucune séance à afficher.</p>}
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
