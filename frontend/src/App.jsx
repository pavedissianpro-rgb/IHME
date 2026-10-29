import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, CalendarDays, Check, ChevronDown, Clock3, Download, LogIn, LogOut,
  MapPin, Pencil, Plus, Shield, Trash2, UserRound, Users, X
} from "lucide-react";

const apiBase = `${import.meta.env.BASE_URL}api`;
const statusOptions = [
  { value: "present", label: "Présent", symbol: "✓" },
  { value: "incertain", label: "Incertain", symbol: "?" },
  { value: "absent", label: "Absent", symbol: "×" }
];

function displayDate(value, options = {}) {
  const date = String(value).slice(0, 10);
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: options.year ? "numeric" : undefined,
    timeZone: "Europe/Paris"
  }).format(new Date(`${date}T12:00:00Z`));
}

function displayTime(value) {
  return String(value).slice(0, 5);
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`${apiBase}${path.startsWith("/") ? path : `/${path}`}`, {
      ...options,
      credentials: "same-origin",
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch {
    throw new Error("Le serveur est momentanément indisponible. Vérifiez votre connexion puis réessayez.");
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") || "";
  let payload = null;
  if (contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch {
      throw new Error("Le serveur a renvoyé une réponse invalide. Veuillez réessayer.");
    }
  }
  if (!response.ok) {
    throw new Error(payload?.error || "La demande n’a pas pu aboutir. Réessayez dans un instant.");
  }
  return payload;
}

function Shuttlecock({ size = 38 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 64 64" fill="none">
      <path d="m17 12 30 30M10 19l30 30M22 8l30 30" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="m43 39 13 13-9 9-13-13a6.4 6.4 0 0 1 9-9Z" fill="#F4B942" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="m9 10 5 5m2-10 5 5" stroke="#F4B942" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function App() {
  const [sessions, setSessions] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [coach, setCoach] = useState(false);
  const [selectedSession, setSelectedSession] = useState("");
  const [responses, setResponses] = useState([]);
  const [counts, setCounts] = useState({ present: 0, absent: 0, incertain: 0 });
  const [playerForm, setPlayerForm] = useState({ firstName: "", lastName: "", status: "" });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [coachTab, setCoachTab] = useState("seances");
  const [coachSessions, setCoachSessions] = useState([]);
  const [players, setPlayers] = useState([]);
  const [coachResponses, setCoachResponses] = useState([]);
  const [manageSessionId, setManageSessionId] = useState("");
  const [sessionEditId, setSessionEditId] = useState("");
  const [sessionForm, setSessionForm] = useState(emptySessionForm);
  const [playerEdit, setPlayerEdit] = useState({ firstName: "", lastName: "" });
  const [trainerName, setTrainerName] = useState("");
  const [mergeForm, setMergeForm] = useState({ keepPlayerId: "", mergePlayerId: "" });
  const [stats, setStats] = useState({ players: [], sessions: [] });
  const [dateRange, setDateRange] = useState({ from: "", to: "" });
  const [history, setHistory] = useState({ playerId: "", items: [] });

  const nextSession = sessions[0];
  const chosenSession = useMemo(
    () => sessions.find((session) => String(session.id) === String(selectedSession)),
    [sessions, selectedSession]
  );

  const loadPublic = useCallback(async () => {
    const [sessionData, trainerData] = await Promise.all([
      api("/sessions"), api("/trainers")
    ]);
    setSessions(sessionData.sessions);
    setTrainers(trainerData.trainers);
    setSelectedSession((current) =>
      sessionData.sessions.some((session) => String(session.id) === String(current))
        ? String(current)
        : String(sessionData.sessions[0]?.id || "")
    );
    return sessionData.sessions;
  }, []);

  const loadSessionResponses = useCallback(async (id) => {
    if (!id) {
      setResponses([]);
      setCounts({ present: 0, absent: 0, incertain: 0 });
      return;
    }
    const data = await api(`/sessions/${id}/responses`);
    setResponses(data.responses);
    setCounts(data.counts);
  }, []);

  const loadCoachLists = useCallback(async () => {
    const [sessionData, playerData, trainerData] = await Promise.all([
      api("/coach/sessions"), api("/players"), api("/trainers")
    ]);
    setCoachSessions(sessionData.sessions);
    setPlayers(playerData.players);
    setTrainers(trainerData.trainers);
    setManageSessionId((current) =>
      sessionData.sessions.some((session) => String(session.id) === String(current))
        ? String(current)
        : String(sessionData.sessions[0]?.id || "")
    );
  }, []);

  const refresh = useCallback(async () => {
    setError("");
    try {
      await loadPublic();
      try {
        await api("/auth/me");
        setCoach(true);
      } catch (requestError) {
        if (requestError.message.startsWith("Connectez-vous") ||
            requestError.message.startsWith("Votre session a expiré")) {
          setCoach(false);
        } else {
          throw requestError;
        }
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [loadPublic]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    loadSessionResponses(selectedSession).catch((requestError) => setError(requestError.message));
  }, [loadSessionResponses, selectedSession]);

  useEffect(() => {
    if (!coach) return;
    loadCoachLists().catch((requestError) => setError(requestError.message));
  }, [coach, loadCoachLists]);

  useEffect(() => {
    if (!coach || coachTab !== "seances" || !manageSessionId) return;
    api(`/sessions/${manageSessionId}/coach-responses`)
      .then((data) => setCoachResponses(data.players))
      .catch((requestError) => setError(requestError.message));
  }, [coach, coachTab, manageSessionId]);

  useEffect(() => {
    if (!coach || coachTab !== "statistiques") return;
    const query = new URLSearchParams();
    if (dateRange.from) query.set("from", dateRange.from);
    if (dateRange.to) query.set("to", dateRange.to);
    api(`/stats${query.size ? `?${query}` : ""}`)
      .then(setStats)
      .catch((requestError) => setError(requestError.message));
  }, [coach, coachTab, dateRange]);

  async function submitResponse(event) {
    event.preventDefault();
    if (!playerForm.firstName.trim() || !playerForm.lastName.trim()) {
      setError("Saisissez votre prénom et votre nom pour répondre.");
      return;
    }
    if (!selectedSession || !playerForm.status) {
      setError("Choisissez une séance et votre statut de présence.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/responses", {
        method: "POST",
        body: { ...playerForm, sessionId: Number(selectedSession) }
      });
      setNotice("Votre réponse est enregistrée. Vous pouvez la modifier à tout moment.");
      await Promise.all([loadPublic(), loadSessionResponses(selectedSession)]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitLogin(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      await api("/auth/login", { method: "POST", body: { password: form.get("password") } });
      setCoach(true);
      setLoginOpen(false);
      setCoachTab("seances");
      setNotice("Connexion réussie. Bienvenue dans l’espace entraîneur.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
      setCoach(false);
      setCoachTab("seances");
      setNotice("Vous êtes déconnecté.");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function editSession(session) {
    setSessionEditId(String(session.id));
    setSessionForm({
      sessionDate: String(session.session_date).slice(0, 10),
      startTime: displayTime(session.start_time),
      endTime: displayTime(session.end_time),
      location: session.location,
      coachName: session.coach_name,
      note: session.note || ""
    });
  }

  function resetSessionForm() {
    setSessionEditId("");
    setSessionForm(emptySessionForm());
  }

  async function saveSession(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(sessionEditId ? `/sessions/${sessionEditId}` : "/sessions", {
        method: sessionEditId ? "PATCH" : "POST",
        body: sessionForm
      });
      setNotice(sessionEditId ? "La séance a été modifiée." : "La séance a été créée.");
      resetSessionForm();
      await Promise.all([loadPublic(), loadCoachLists()]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelSession(id) {
    if (!window.confirm("Annuler cette séance ? Elle ne sera plus proposée aux joueurs.")) return;
    try {
      await api(`/sessions/${id}/cancel`, { method: "PATCH", body: {} });
      setNotice("La séance est annulée.");
      await Promise.all([loadPublic(), loadCoachLists()]);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function deleteSession(id) {
    if (!window.confirm("Supprimer définitivement cette séance et ses réponses ?")) return;
    try {
      await api(`/sessions/${id}`, { method: "DELETE" });
      setNotice("La séance et ses réponses ont été supprimées.");
      await Promise.all([loadPublic(), loadCoachLists()]);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function addPlayer(event) {
    event.preventDefault();
    try {
      await api("/players", { method: "POST", body: playerEdit });
      setPlayerEdit({ firstName: "", lastName: "" });
      setNotice("Le joueur a été ajouté.");
      await loadCoachLists();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function deletePlayer(player) {
    if (!window.confirm(`Supprimer ${player.first_name} ${player.last_name} et ses réponses ?`)) return;
    try {
      await api(`/players/${player.id}`, { method: "DELETE" });
      setNotice("Le joueur a été supprimé.");
      await loadCoachLists();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function mergePlayers(event) {
    event.preventDefault();
    try {
      await api("/players/merge", { method: "POST", body: {
        keepPlayerId: Number(mergeForm.keepPlayerId),
        mergePlayerId: Number(mergeForm.mergePlayerId)
      } });
      setMergeForm({ keepPlayerId: "", mergePlayerId: "" });
      setNotice("Les doublons ont été fusionnés.");
      await loadCoachLists();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function addTrainer(event) {
    event.preventDefault();
    try {
      await api("/trainers", { method: "POST", body: { name: trainerName } });
      setTrainerName("");
      setNotice("L’entraîneur a été ajouté à la liste réutilisable.");
      await loadCoachLists();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function updateResponse(playerId, changes) {
    try {
      await api(`/sessions/${manageSessionId}/responses/${playerId}`, {
        method: "PATCH", body: changes
      });
      const data = await api(`/sessions/${manageSessionId}/coach-responses`);
      setCoachResponses(data.players);
      await loadSessionResponses(selectedSession);
      setNotice("La réponse a été mise à jour.");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function showHistory(playerId) {
    if (history.playerId === String(playerId)) {
      setHistory({ playerId: "", items: [] });
      return;
    }
    try {
      const data = await api(`/players/${playerId}/history`);
      setHistory({ playerId: String(playerId), items: data.history });
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function downloadCsv() {
    const query = new URLSearchParams();
    if (dateRange.from) query.set("from", dateRange.from);
    if (dateRange.to) query.set("to", dateRange.to);
    try {
      const response = await fetch(`${apiBase}/stats.csv${query.size ? `?${query}` : ""}`, {
        credentials: "same-origin"
      });
      if (!response.ok) {
        let payload = null;
        if ((response.headers.get("content-type") || "").includes("application/json")) {
          try {
            payload = await response.json();
          } catch {
            throw new Error("Le serveur a renvoyé une réponse invalide. Réessayez plus tard.");
          }
        }
        throw new Error(payload?.error || "L’export n’a pas pu être téléchargé.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "statistiques-salbris.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError instanceof TypeError
        ? "Le serveur est momentanément indisponible. Réessayez plus tard."
        : requestError.message);
    }
  }

  if (loading) {
    return <main className="loading-view" role="status"><span className="spinner" />Chargement du club…</main>;
  }

  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="Accueil du Badminton Club de Salbris">
          <span className="brand-icon"><Shuttlecock /></span>
          <span><strong>Badminton Club</strong><small>DE SALBRIS</small></span>
        </a>
        <div className="header-actions">
          {coach
            ? <button className="header-button" onClick={logout}><LogOut size={17} /> Déconnexion</button>
            : <button className="header-button" onClick={() => setLoginOpen(true)}><Shield size={17} /> Espace entraîneur</button>}
        </div>
      </header>

      <main>
        <section className="welcome">
          <div className="welcome-copy">
            <p className="eyebrow"><span className="eyebrow-dot" /> CLUB DE BADMINTON · SALBRIS</p>
            <h1>Le prochain match<br />commence <em>ici.</em></h1>
            <p className="welcome-text">Consultez les séances et indiquez simplement si vous serez de la partie.</p>
          </div>
          <div className="court-art" aria-hidden="true">
            <div className="court-lines" />
            <div className="court-shuttle"><Shuttlecock size={90} /></div>
            <span className="court-caption">À vos raquettes !</span>
          </div>
        </section>

        {(error || notice) && (
          <div className={`feedback ${error ? "feedback-error" : "feedback-success"}`} role={error ? "alert" : "status"}>
            {error ? <X size={18} /> : <Check size={18} />}
            <span>{error || notice}</span>
            <button aria-label="Fermer le message" onClick={() => { setError(""); setNotice(""); }}><X size={17} /></button>
          </div>
        )}

        <section className="next-section" aria-labelledby="next-heading">
          <div className="section-title">
            <div><p className="eyebrow">LE RENDEZ-VOUS À VENIR</p><h2 id="next-heading">Prochaine séance</h2></div>
            <span className="section-icon"><CalendarDays /></span>
          </div>
          {nextSession ? (
            <article className="next-session-card">
              <div className="next-date">
                <span>{displayDate(nextSession.session_date).split(" ")[0]}</span>
                <strong>{String(nextSession.session_date).slice(8, 10)}</strong>
                <span>{new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "Europe/Paris" }).format(new Date(`${String(nextSession.session_date).slice(0, 10)}T12:00:00Z`))}</span>
              </div>
              <div className="next-session-details">
                <p className="eyebrow">ENTRAÎNEMENT CLUB</p>
                <h3>{displayDate(nextSession.session_date, { year: true })}</h3>
                <div className="detail-list">
                  <span><Clock3 size={17} /> {displayTime(nextSession.start_time)} – {displayTime(nextSession.end_time)}</span>
                  <span><MapPin size={17} /> {nextSession.location}</span>
                  <span><UserRound size={17} /> Entraîneur : {nextSession.coach_name}</span>
                </div>
                {nextSession.note && <p className="session-note">{nextSession.note}</p>}
              </div>
              <a className="next-cta" href="#repondre">Répondre <span aria-hidden="true">↓</span></a>
            </article>
          ) : (
            <div className="empty-panel"><CalendarDays /><div><strong>Aucune séance prévue</strong><p>Les prochains entraînements seront affichés ici.</p></div></div>
          )}
        </section>

        <section className="response-section" id="repondre" aria-labelledby="response-heading">
          <div className="section-title">
            <div><p className="eyebrow">RÉPONSE RAPIDE, SANS COMPTE</p><h2 id="response-heading">Vous venez jouer ?</h2></div>
            <span className="section-icon"><Users /></span>
          </div>
          <form className="response-card" onSubmit={submitResponse}>
            <div className="form-grid player-name-fields">
              <label>Prénom<input autoComplete="given-name" maxLength="100" required value={playerForm.firstName} onChange={(event) => setPlayerForm({ ...playerForm, firstName: event.target.value })} /></label>
              <label>Nom<input autoComplete="family-name" maxLength="100" required value={playerForm.lastName} onChange={(event) => setPlayerForm({ ...playerForm, lastName: event.target.value })} /></label>
            </div>
            <label>Séance
              <span className="select-control"><select required value={selectedSession} onChange={(event) => setSelectedSession(event.target.value)}>
                <option value="">Choisir une séance à venir</option>
                {sessions.map((session) => <option value={session.id} key={session.id}>
                  {displayDate(session.session_date)} · {displayTime(session.start_time)} · {session.coach_name}
                </option>)}
              </select><ChevronDown size={18} aria-hidden="true" /></span>
            </label>
            <fieldset className="status-fieldset">
              <legend>Votre réponse</legend>
              <div className="status-choices">
                {statusOptions.map((option) => (
                  <button
                    className={`status-choice status-${option.value}${playerForm.status === option.value ? " is-selected" : ""}`}
                    type="button"
                    key={option.value}
                    aria-pressed={playerForm.status === option.value}
                    onClick={() => setPlayerForm({ ...playerForm, status: option.value })}
                  >
                    <span className="status-symbol" aria-hidden="true">{option.symbol}</span>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="form-footer">
              <p>Votre nom et votre réponse seront visibles par les autres joueurs.</p>
              <button className="primary-button" type="submit" disabled={busy || !sessions.length}>
                {busy ? "Enregistrement…" : "Enregistrer ma réponse"}
              </button>
            </div>
          </form>
        </section>

        <section className="attendance-section" aria-labelledby="attendance-heading">
          <div className="section-title">
            <div><p className="eyebrow">ON JOUE COLLECTIF</p><h2 id="attendance-heading">Les réponses des joueurs</h2></div>
            <label className="inline-select">Séance
              <span className="select-control"><select value={selectedSession} onChange={(event) => setSelectedSession(event.target.value)}>
                <option value="">Choisir une séance</option>
                {sessions.map((session) => <option key={session.id} value={session.id}>
                  {displayDate(session.session_date)} · {displayTime(session.start_time)}
                </option>)}
              </select><ChevronDown size={17} /></span>
            </label>
          </div>
          {chosenSession ? (
            <div className="attendance-card">
              <div className="attendance-summary">
                {statusOptions.map((option) => <div className={`summary-item summary-${option.value}`} key={option.value}>
                  <span>{counts[option.value]}</span><strong>{option.label}</strong>
                </div>)}
              </div>
              <div className="answer-groups">
                {statusOptions.map((option) => {
                  const group = responses.filter((response) => response.status === option.value);
                  return <div className="answer-group" key={option.value}>
                    <h3><span className={`group-mark group-${option.value}`}>{option.symbol}</span>{option.label}<span className="group-count">{group.length}</span></h3>
                    {group.length ? <ul>{group.map((response) => <li key={response.player_id}>{response.first_name} {response.last_name}</li>)}</ul>
                      : <p className="empty-answer">Personne pour le moment.</p>}
                  </div>;
                })}
              </div>
            </div>
          ) : <div className="empty-panel"><CalendarDays /><div><strong>Aucune séance à afficher</strong><p>Revenez bientôt pour choisir le prochain entraînement.</p></div></div>}
        </section>

        {coach && (
          <section className="coach-area" aria-labelledby="coach-heading">
            <div className="section-title coach-title">
              <div><p className="eyebrow">ACCÈS RÉSERVÉ</p><h2 id="coach-heading">Espace entraîneur</h2></div>
              <span className="section-icon"><Shield /></span>
            </div>
            <nav className="coach-tabs" aria-label="Navigation espace entraîneur">
              {[["seances", "Séances"], ["joueurs", "Joueurs"], ["statistiques", "Statistiques"]].map(([value, label]) => (
                <button key={value} className={coachTab === value ? "active" : ""} onClick={() => setCoachTab(value)}>{label}</button>
              ))}
            </nav>
            {coachTab === "seances" && (
              <div className="coach-grid">
                <div className="coach-card">
                  <h3>{sessionEditId ? "Modifier la séance" : "Créer une séance"}</h3>
                  <form className="coach-form" onSubmit={saveSession}>
                    <label>Date<input type="date" required value={sessionForm.sessionDate} onChange={(event) => setSessionForm({ ...sessionForm, sessionDate: event.target.value })} /></label>
                    <div className="two-fields">
                      <label>Début<input type="time" required value={sessionForm.startTime} onChange={(event) => setSessionForm({ ...sessionForm, startTime: event.target.value })} /></label>
                      <label>Fin<input type="time" required value={sessionForm.endTime} onChange={(event) => setSessionForm({ ...sessionForm, endTime: event.target.value })} /></label>
                    </div>
                    <label>Lieu<input maxLength="160" required value={sessionForm.location} onChange={(event) => setSessionForm({ ...sessionForm, location: event.target.value })} /></label>
                    <label>Entraîneur
                      <input list="trainer-options" maxLength="100" required value={sessionForm.coachName} onChange={(event) => setSessionForm({ ...sessionForm, coachName: event.target.value })} />
                      <datalist id="trainer-options">{trainers.map((trainer) => <option value={trainer.name} key={trainer.id} />)}</datalist>
                    </label>
                    <label>Note facultative<textarea maxLength="1000" rows="3" value={sessionForm.note} onChange={(event) => setSessionForm({ ...sessionForm, note: event.target.value })} /></label>
                    <div className="form-actions"><button className="primary-button" disabled={busy}>{sessionEditId ? "Enregistrer" : "Ajouter la séance"}</button>
                      {sessionEditId && <button className="secondary-button" type="button" onClick={resetSessionForm}>Annuler</button>}</div>
                  </form>
                  <form className="trainer-add" onSubmit={addTrainer}>
                    <label>Ajouter un entraîneur à la liste<input value={trainerName} maxLength="100" required onChange={(event) => setTrainerName(event.target.value)} /></label>
                    <button className="icon-button" aria-label="Ajouter l’entraîneur"><Plus /></button>
                  </form>
                </div>

                <div className="coach-card">
                  <h3>Séances à venir</h3>
                  {coachSessions.length ? <div className="manage-session-list">{coachSessions.map((session) => (
                    <article className="manage-session" key={session.id}>
                      <div><strong>{displayDate(session.session_date, { year: true })}</strong><span>{displayTime(session.start_time)}–{displayTime(session.end_time)} · {session.location}</span><small>Entraîneur : {session.coach_name}</small>{session.note && <small>{session.note}</small>}</div>
                      <div className="manage-actions">
                        <button aria-label={`Modifier le ${displayDate(session.session_date)}`} onClick={() => editSession(session)}><Pencil size={17} /></button>
                        <button aria-label={`Annuler le ${displayDate(session.session_date)}`} onClick={() => cancelSession(session.id)}><X size={18} /></button>
                        <button aria-label={`Supprimer le ${displayDate(session.session_date)}`} onClick={() => deleteSession(session.id)}><Trash2 size={17} /></button>
                      </div>
                    </article>
                  ))}</div> : <p className="muted">Aucune séance à venir.</p>}
                  <div className="coach-subsection">
                    <h3>Réponses et présence réelle</h3>
                    {coachSessions.length ? <>
                      <label>Séance
                        <span className="select-control"><select value={manageSessionId} onChange={(event) => setManageSessionId(event.target.value)}>
                          {coachSessions.map((session) => <option key={session.id} value={session.id}>{displayDate(session.session_date)} · {displayTime(session.start_time)}</option>)}
                        </select><ChevronDown size={17} /></span>
                      </label>
                      {coachResponses.length ? <div className="coach-response-list">{coachResponses.map((player) => (
                        <div className="coach-response-row" key={player.player_id}>
                          <strong>{player.first_name} {player.last_name}</strong>
                          <label>Réponse<select value={player.status || ""} onChange={(event) => updateResponse(player.player_id, { status: event.target.value || "incertain" })}>
                            <option value="">Sans réponse</option>{statusOptions.map((status) => <option value={status.value} key={status.value}>{status.label}</option>)}
                          </select></label>
                          <label>Présence réelle<select value={player.actual_presence === null ? "" : String(player.actual_presence)} onChange={(event) => updateResponse(player.player_id, { actualPresence: event.target.value === "" ? null : event.target.value === "true" })}>
                            <option value="">À confirmer</option><option value="true">Présent réellement</option><option value="false">Absent réellement</option>
                          </select></label>
                        </div>
                      ))}</div> : <p className="muted">Aucun joueur enregistré pour cette séance.</p>}
                    </> : <p className="muted">Créez une séance pour gérer les réponses.</p>}
                  </div>
                </div>
              </div>
            )}

            {coachTab === "joueurs" && (
              <div className="coach-grid">
                <div className="coach-card">
                  <h3>Ajouter un joueur</h3>
                  <form className="coach-form" onSubmit={addPlayer}>
                    <label>Prénom<input maxLength="100" required value={playerEdit.firstName} onChange={(event) => setPlayerEdit({ ...playerEdit, firstName: event.target.value })} /></label>
                    <label>Nom<input maxLength="100" required value={playerEdit.lastName} onChange={(event) => setPlayerEdit({ ...playerEdit, lastName: event.target.value })} /></label>
                    <button className="primary-button">Ajouter le joueur</button>
                  </form>
                  <h3 className="subheading">Fusionner deux doublons</h3>
                  <form className="merge-form" onSubmit={mergePlayers}>
                    <label>Conserver<select required value={mergeForm.keepPlayerId} onChange={(event) => setMergeForm({ ...mergeForm, keepPlayerId: event.target.value })}><option value="">Choisir un joueur</option>{players.map((player) => <option key={player.id} value={player.id}>{player.first_name} {player.last_name}</option>)}</select></label>
                    <label>Fusionner avec<select required value={mergeForm.mergePlayerId} onChange={(event) => setMergeForm({ ...mergeForm, mergePlayerId: event.target.value })}><option value="">Choisir le doublon</option>{players.map((player) => <option key={player.id} value={player.id}>{player.first_name} {player.last_name}</option>)}</select></label>
                    <button className="secondary-button">Fusionner les réponses</button>
                  </form>
                </div>
                <div className="coach-card">
                  <h3>Joueurs inscrits <span className="count-pill">{players.length}</span></h3>
                  {players.length ? <div className="player-list">{players.map((player) => <div className="player-row" key={player.id}>
                    <span className="player-avatar">{player.first_name.slice(0, 1).toLocaleUpperCase("fr")}</span>
                    <strong>{player.first_name} {player.last_name}</strong>
                    <button aria-label={`Voir l’historique de ${player.first_name} ${player.last_name}`} onClick={() => showHistory(player.id)}><Activity size={17} /></button>
                    <button aria-label={`Supprimer ${player.first_name} ${player.last_name}`} onClick={() => deletePlayer(player)}><Trash2 size={17} /></button>
                    {history.playerId === String(player.id) && <div className="player-history">
                      <strong>Historique des séances</strong>
                      {history.items.length ? history.items.map((item) => <p key={item.session_id}>
                        {displayDate(item.session_date)} · {displayTime(item.start_time)} — {statusLabel(item.status)}
                        {item.actual_presence !== null && ` · Réel : ${item.actual_presence ? "présent" : "absent"}`}
                      </p>) : <p>Aucune réponse enregistrée.</p>}
                    </div>}
                  </div>)}</div> : <p className="muted">Aucun joueur n’a répondu pour le moment.</p>}
                </div>
              </div>
            )}

            {coachTab === "statistiques" && (
              <div className="coach-card stats-card">
                <div className="stats-toolbar">
                  <h3><Activity size={20} /> Présences du club</h3>
                  <div className="range-fields"><label>Du<input type="date" value={dateRange.from} onChange={(event) => setDateRange({ ...dateRange, from: event.target.value })} /></label><label>Au<input type="date" value={dateRange.to} onChange={(event) => setDateRange({ ...dateRange, to: event.target.value })} /></label>
                    <button className="secondary-button" onClick={downloadCsv}><Download size={17} /> Export CSV</button></div>
                </div>
                <h4>Présence par séance</h4>
                {stats.sessions.length ? <div className="chart" role="img" aria-label="Graphique du nombre de présences réelles par séance">
                  {stats.sessions.map((session) => {
                    const max = Math.max(1, ...stats.sessions.map((entry) => entry.present_count));
                    const height = Math.max(4, Math.round((session.present_count / max) * 112));
                    return <div className="chart-column" key={session.id} title={`${session.present_count} présent(s), ${Number(session.attendance_rate).toLocaleString("fr-FR")} %`}>
                      <span>{session.present_count}</span><div className="bar-track"><i style={{ height: `${height}px` }} /></div>
                      <small>{String(session.session_date).slice(5, 10)}</small>
                      <small>{Number(session.attendance_rate).toLocaleString("fr-FR")} %</small>
                    </div>;
                  })}
                </div> : <p className="muted">Aucune séance passée dans cette période.</p>}
                <div className="table-scroll"><table>
                  <thead><tr><th>Joueur</th><th>Séances</th><th>Présences</th><th>Absences</th><th>Incertaines</th><th>Absences sans réponse</th><th>Taux de présence</th></tr></thead>
                  <tbody>{stats.players.length ? stats.players.map((player) => <tr key={player.id}>
                    <td>{player.first_name} {player.last_name}</td><td>{player.sessions_count}</td><td>{player.present_count}</td><td>{player.absent_count}</td><td>{player.uncertain_count}</td><td>{player.unanswered_count}</td><td>{Number(player.attendance_rate).toLocaleString("fr-FR")} %</td>
                  </tr>) : <tr><td colSpan="7">Aucun joueur pour cette période.</td></tr>}</tbody>
                </table></div>
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="site-footer"><span><Shuttlecock size={22} /> Badminton Club de Salbris</span><span>Jouons ensemble, tout simplement.</span></footer>

      {loginOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setLoginOpen(false); }}>
        <form className="login-dialog" onSubmit={submitLogin} aria-labelledby="login-title">
          <button type="button" className="modal-close" aria-label="Fermer" onClick={() => setLoginOpen(false)}><X /></button>
          <span className="section-icon"><Shield /></span>
          <p className="eyebrow">ACCÈS RÉSERVÉ</p>
          <h2 id="login-title">Connexion entraîneur</h2>
          <p>Connectez-vous pour gérer les séances et les présences.</p>
          <label>Mot de passe<input name="password" type="password" autoComplete="current-password" required /></label>
          <button className="primary-button" disabled={busy}><LogIn size={17} /> {busy ? "Connexion…" : "Se connecter"}</button>
        </form>
      </div>}
    </div>
  );
}

function emptySessionForm() {
  return { sessionDate: "", startTime: "19:00", endTime: "21:00", location: "Gymnase Pillon", coachName: "", note: "" };
}

function statusLabel(status) {
  return statusOptions.find((option) => option.value === status)?.label || "Sans réponse";
}

export default App;
