import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../utils/api.js';
import Spinner from '../components/common/Spinner.jsx';
import './TeamPickerPage.css';

const ROLE_FILTERS = [
  { key: 'ALL',  label: 'All' },
  { key: 'BAT',  label: 'Bat' },
  { key: 'BOWL', label: 'Bowl' },
  { key: 'AR',   label: 'AR' },
  { key: 'WK',   label: 'WK' },
];

function normaliseRole(role) {
  if (!role) return '';
  const r = role.toLowerCase();
  if (r.includes('wk') || r.includes('keeper')) return 'WK';
  if (r.includes('all')) return 'AR';
  if (r.includes('bowl')) return 'Bowl';
  if (r.includes('bat')) return 'Bat';
  return role;
}

function shortName(name) {
  const parts = name.trim().split(' ');
  if (parts.length === 1) return name;
  return parts[parts.length - 1];
}

export default function TeamPickerPage() {
  const { matchId } = useParams();
  const navigate    = useNavigate();

  const [match, setMatch]       = useState(null);
  const [squad, setSquad]       = useState([]);
  const [existing, setExisting] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [filter, setFilter]     = useState('ALL');

  const [tapState, setTapState] = useState({});  // playerId → 0|1|2 (none|main|backup)
  const [captainId, setCaptain] = useState(null);
  const [vcId, setVc]           = useState(null);

  useEffect(() => { loadData(); }, [matchId]);

  async function loadData() {
    try {
      const [mRes, sRes] = await Promise.all([
        api.get(`/matches/${matchId}`),
        api.get(`/matches/${matchId}/squad`),
      ]);
      setMatch(mRes.data.match);
      setSquad(sRes.data.squad || []);
      try {
        const tRes = await api.get(`/teams/match/${matchId}`);
        const t = tRes.data.team;
        setExisting(t);
        const states = {};
        t.players.forEach(p => { states[p.id] = p.is_backup ? 2 : 1; });
        setTapState(states);
        setCaptain(t.captain_id);
        setVc(t.vice_captain_id);
      } catch {}
    } catch {
      setError('Failed to load squad');
    } finally {
      setLoading(false);
    }
  }

  const teamNames    = useMemo(() => [...new Set(squad.map(p => p.team))].sort(), [squad]);
  const mainPlayers  = useMemo(() => squad.filter(p => tapState[p.id] === 1), [squad, tapState]);
  const backupPlayers = useMemo(() => squad.filter(p => tapState[p.id] === 2), [squad, tapState]);
  const mainCount    = mainPlayers.length;
  const backupCount  = backupPlayers.length;

  function filteredForTeam(teamName) {
    return squad.filter(p => {
      if (p.team !== teamName) return false;
      if (filter === 'ALL') return true;
      const r = normaliseRole(p.role);
      if (filter === 'BAT')  return r === 'Bat';
      if (filter === 'BOWL') return r === 'Bowl';
      if (filter === 'AR')   return r === 'AR';
      if (filter === 'WK')   return r === 'WK';
      return true;
    });
  }

  function handleTap(playerId) {
    const cur = tapState[playerId] || 0;
    if (cur === 0) {
      if (mainCount >= 11) return;
      setTapState(s => ({ ...s, [playerId]: 1 }));
    } else if (cur === 1) {
      if (backupCount >= 2) {
        // Deselect instead of moving to backup when backup is full
        if (captainId === playerId) setCaptain(null);
        if (vcId === playerId) setVc(null);
        setTapState(s => ({ ...s, [playerId]: 0 }));
        return;
      }
      if (captainId === playerId) setCaptain(null);
      if (vcId === playerId) setVc(null);
      setTapState(s => ({ ...s, [playerId]: 2 }));
    } else {
      if (captainId === playerId) setCaptain(null);
      if (vcId === playerId) setVc(null);
      setTapState(s => ({ ...s, [playerId]: 0 }));
    }
  }

  function handleCaptain(e, playerId) {
    e.stopPropagation();
    if (vcId === playerId) setVc(null);
    setCaptain(c => c === playerId ? null : playerId);
  }

  function handleVc(e, playerId) {
    e.stopPropagation();
    if (captainId === playerId) setCaptain(null);
    setVc(v => v === playerId ? null : playerId);
  }

  const canSubmit = mainCount === 11 && backupCount === 2 && captainId && vcId;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        playerIds:     mainPlayers.map(p => p.id),
        backupIds:     backupPlayers.map(p => p.id),
        captainId,
        viceCaptainId: vcId,
      };
      if (existing) {
        await api.put(`/teams/${existing.id}`, payload);
      } else {
        await api.post(`/teams/match/${matchId}`, payload);
      }
      navigate(`/match/${matchId}/live`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save team');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner center />;

  return (
    <div className="picker-page">

      {/* Top bar */}
      <div className="picker-topbar">
        <button className="btn-back" onClick={() => navigate(-1)}>‹</button>
        <div className="picker-topbar-center">
          <span className="picker-topbar-title">Pick your team</span>
          <span className="picker-topbar-match">{match?.team_a} vs {match?.team_b}</span>
        </div>
        <div className="picker-counters">
          <span className={`picker-counter ${mainCount === 11 ? 'counter-done' : ''}`}>{mainCount}/11</span>
          <span className={`picker-counter counter-bak ${backupCount === 2 ? 'counter-done' : ''}`}>{backupCount}/2</span>
        </div>
      </div>

      {/* Role filters */}
      <div className="picker-filters">
        {ROLE_FILTERS.map(f => (
          <button key={f.key} className={`filter-btn ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="picker-legend">
        <span className="leg-item"><span className="leg-pip pip-xi" />XI</span>
        <span className="leg-item"><span className="leg-pip pip-main" />Main (tap)</span>
        <span className="leg-item"><span className="leg-pip pip-bak" />Backup (2× tap)</span>
        <span className="leg-item leg-cap-item">C = 2×pts &nbsp; VC = 1.5×</span>
      </div>

      {/* Two-column squad */}
      <div className="picker-grid">
        {teamNames.map(teamName => {
          const players = filteredForTeam(teamName);
          const teamMainCount = squad.filter(p => p.team === teamName && tapState[p.id] === 1).length;
          return (
            <div key={teamName} className="picker-col">
              <div className="picker-col-hdr">
                <span className="picker-col-name">{teamName}</span>
                <span className="picker-col-count">{teamMainCount} picked</span>
              </div>
              {players.length === 0 && <div className="picker-empty text-muted text-sm">No players</div>}
              {players.map(p => {
                const state  = tapState[p.id] || 0;
                const isCap  = captainId === p.id;
                const isVc   = vcId === p.id;
                const isMain = state === 1;
                const isBak  = state === 2;
                const dimmed = state === 0 && ((mainCount >= 11) || false);

                return (
                  <div
                    key={p.id}
                    className={`prow ${isMain ? 'prow-main' : ''} ${isBak ? 'prow-bak' : ''} ${isCap ? 'prow-cap' : ''} ${isVc ? 'prow-vc' : ''} ${dimmed ? 'prow-dim' : ''}`}
                    onClick={() => handleTap(p.id)}
                  >
                    <div className="prow-left">
                      <span className={`pip ${p.is_playing_xi ? 'pip-xi-sm' : 'pip-empty'}`} />
                      <div className="prow-info">
                        <span className="prow-name">{p.name}</span>
                        <span className="prow-role">{normaliseRole(p.role)}</span>
                      </div>
                    </div>
                    <div className="prow-right">
                      {isMain && (
                        <>
                          <button className={`role-btn ${isCap ? 'role-btn-cap' : ''}`} onClick={e => handleCaptain(e, p.id)}>C</button>
                          <button className={`role-btn ${isVc ? 'role-btn-vc' : ''}`} onClick={e => handleVc(e, p.id)} disabled={isCap}>VC</button>
                        </>
                      )}
                      <div className={`sel-circle ${isMain ? 'sel-main' : ''} ${isBak ? 'sel-bak' : ''}`}>
                        {isMain && (isCap ? 'C' : isVc ? 'V' : '✓')}
                        {isBak && 'B'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Team tray */}
      <div className="picker-tray">
        <div className="tray-header">
          <span className="tray-title">Your team</span>
          {mainCount > 0 && !canSubmit && (
            <span className="tray-hint text-sm text-muted">
              {mainCount < 11 ? `${11 - mainCount} more` :
               backupCount < 2 ? `${2 - backupCount} backup${backupCount === 1 ? '' : 's'}` :
               !captainId ? 'Pick captain' : 'Pick VC'}
            </span>
          )}
        </div>
        <div className="tray-chips">
          {mainPlayers.map(p => (
            <span key={p.id} className={`tray-chip ${captainId === p.id ? 'chip-cap' : vcId === p.id ? 'chip-vc' : 'chip-main'}`}>
              {shortName(p.name)}{captainId === p.id ? ' C' : vcId === p.id ? ' VC' : ''}
            </span>
          ))}
          {backupPlayers.map((p, i) => (
            <span key={p.id} className="tray-chip chip-bak">{shortName(p.name)} B{i+1}</span>
          ))}
          {mainCount === 0 && <span className="tray-empty text-muted text-sm">Tap players to add</span>}
        </div>
        {error && <p className="auth-error">{error}</p>}
        <button className="btn btn-primary btn-full mt-3" disabled={!canSubmit || saving} onClick={submit}>
          {saving ? <span className="spinner" style={{width:16,height:16,borderWidth:2}} /> : existing ? 'Update Team' : 'Submit Team'}
        </button>
      </div>

    </div>
  );
}
