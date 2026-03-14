import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../utils/api.js';
import Spinner from '../components/common/Spinner.jsx';
import './TeamPickerPage.css';

const STEPS = ['SELECT', 'BACKUPS', 'CAPTAIN', 'CONFIRM'];

export default function TeamPickerPage() {
  const { matchId } = useParams();
  const navigate    = useNavigate();

  const [match, setMatch]     = useState(null);
  const [squad, setSquad]     = useState([]);
  const [existing, setExisting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [step, setStep]       = useState(0); // 0=SELECT, 1=BACKUPS, 2=CAPTAIN, 3=CONFIRM

  // Selections
  const [selected, setSelected]   = useState(new Set()); // main 11
  const [backups, setBackups]     = useState([]);         // [b1id, b2id]
  const [captainId, setCaptain]   = useState(null);
  const [vcId, setVc]             = useState(null);
  const [filter, setFilter]       = useState('ALL');

  useEffect(() => { loadData(); }, [matchId]);

  async function loadData() {
    try {
      const [mRes, sRes] = await Promise.all([
        api.get(`/matches/${matchId}`),
        api.get(`/matches/${matchId}/squad`),
      ]);
      setMatch(mRes.data.match);
      setSquad(sRes.data.squad || []);

      // Try to load existing team
      try {
        const tRes = await api.get(`/teams/match/${matchId}`);
        const t = tRes.data.team;
        setExisting(t);
        // Pre-fill selections
        const mainIds = t.players.filter(p => !p.is_backup).map(p => p.id);
        const bIds    = t.players.filter(p => p.is_backup).sort((a,b) => a.backup_order - b.backup_order).map(p => p.id);
        setSelected(new Set(mainIds));
        setBackups(bIds);
        setCaptain(t.captain_id);
        setVc(t.vice_captain_id);
      } catch {
        // No team yet — fresh pick
      }
    } catch (e) {
      setError('Failed to load match data');
    } finally {
      setLoading(false);
    }
  }

  const teamsByName = useMemo(() => {
    const teams = [...new Set(squad.map(p => p.team))];
    return teams;
  }, [squad]);

  const filteredSquad = useMemo(() => {
    if (filter === 'ALL') return squad;
    if (filter === 'XI')  return squad.filter(p => p.is_playing_xi);
    return squad.filter(p => p.team === filter);
  }, [squad, filter]);

  function togglePlayer(id) {
    if (step !== 0) return;
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
      // If was C or VC, clear
      if (captainId === id) setCaptain(null);
      if (vcId === id) setVc(null);
    } else {
      if (next.size >= 11) return; // max 11
      next.add(id);
    }
    setSelected(next);
  }

  function toggleBackup(id) {
    if (backups.includes(id)) {
      setBackups(backups.filter(b => b !== id));
    } else if (backups.length < 2) {
      setBackups([...backups, id]);
    }
  }

  const mainPlayers = squad.filter(p => selected.has(p.id));
  const backupPlayers = squad.filter(p => backups.includes(p.id));

  async function submit() {
    setSaving(true);
    setError('');
    try {
      const payload = {
        matchId: parseInt(matchId),
        playerIds: [...selected],
        captainId,
        viceCaptainId: vcId,
        backupIds: backups,
      };
      if (existing) {
        await api.put(`/teams/match/${matchId}`, payload);
      } else {
        await api.post('/teams', payload);
      }
      navigate(`/match/${matchId}/live`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save team');
      setSaving(false);
    }
  }

  if (loading) return <Spinner center />;
  if (!match)  return <div className="container mt-8 text-center text-secondary">Match not found</div>;

  if (match.status !== 'upcoming') {
    return (
      <div className="page container mt-8 text-center">
        <p className="text-secondary">Team submission is closed.</p>
        <button className="btn btn-secondary mt-4" onClick={() => navigate(`/match/${matchId}/live`)}>
          View Live Scores
        </button>
      </div>
    );
  }

  return (
    <div className="page picker-page">
      {/* Header */}
      <div className="picker-header">
        <button className="btn-back" onClick={() => step > 0 ? setStep(s => s - 1) : navigate('/')}>
          ‹
        </button>
        <div className="picker-header-info">
          <h2 className="picker-match">{match.team_a} vs {match.team_b}</h2>
          <p className="text-secondary text-sm">
            {step === 0 && `Select 11 players (${selected.size}/11)`}
            {step === 1 && `Choose 2 backup players (${backups.length}/2)`}
            {step === 2 && 'Assign Captain & Vice-Captain'}
            {step === 3 && 'Confirm your team'}
          </p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="picker-steps container">
        {STEPS.map((s, i) => (
          <div key={s} className={`step-dot ${i <= step ? 'active' : ''} ${i < step ? 'done' : ''}`} />
        ))}
      </div>

      {/* ── STEP 0: Select 11 ── */}
      {step === 0 && (
        <>
          {/* Team filter */}
          <div className="picker-filter container">
            {['ALL', 'XI', ...teamsByName].map(f => (
              <button
                key={f}
                className={`filter-btn ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'XI' ? '✓ Playing XI' : f}
              </button>
            ))}
          </div>

          <div className="player-list container">
            {filteredSquad.map(p => {
              const isSelected = selected.has(p.id);
              const disabled   = !isSelected && selected.size >= 11;
              return (
                <PlayerRow
                  key={p.id}
                  player={p}
                  selected={isSelected}
                  disabled={disabled}
                  onClick={() => togglePlayer(p.id)}
                  badge={
                    captainId === p.id ? 'C' :
                    vcId === p.id ? 'VC' :
                    null
                  }
                />
              );
            })}
          </div>

          <div className="picker-footer">
            <div className="picker-count">
              <span className={selected.size === 11 ? 'text-green' : 'text-secondary'}>
                {selected.size}/11 selected
              </span>
            </div>
            <button
              className="btn btn-primary"
              disabled={selected.size !== 11}
              onClick={() => setStep(1)}
            >
              Next: Backups →
            </button>
          </div>
        </>
      )}

      {/* ── STEP 1: Select 2 backups ── */}
      {step === 1 && (
        <>
          <p className="container text-secondary text-sm mt-4 mb-4">
            Pick 2 players NOT in your main 11. They'll auto-swap in if a player doesn't play.
          </p>
          <div className="player-list container">
            {squad.filter(p => !selected.has(p.id)).map(p => {
              const isBackup  = backups.includes(p.id);
              const disabled  = !isBackup && backups.length >= 2;
              const order     = backups.indexOf(p.id) + 1;
              return (
                <PlayerRow
                  key={p.id}
                  player={p}
                  selected={isBackup}
                  disabled={disabled}
                  onClick={() => toggleBackup(p.id)}
                  badge={isBackup ? `B${order}` : null}
                  badgeColor={isBackup ? 'gold' : null}
                />
              );
            })}
          </div>
          <div className="picker-footer">
            <span className={backups.length === 2 ? 'text-green' : 'text-secondary'}>
              {backups.length}/2 backups
            </span>
            <button
              className="btn btn-primary"
              disabled={backups.length !== 2}
              onClick={() => setStep(2)}
            >
              Next: Captain →
            </button>
          </div>
        </>
      )}

      {/* ── STEP 2: Assign C / VC ── */}
      {step === 2 && (
        <>
          <p className="container text-secondary text-sm mt-4 mb-4">
            Tap once for Captain (2×), tap again for Vice-Captain (1.5×).
          </p>
          <div className="player-list container">
            {mainPlayers.map(p => {
              const isCap = captainId === p.id;
              const isVc  = vcId === p.id;
              function handleTap() {
                if (isCap) {
                  setCaptain(null);
                } else if (isVc) {
                  setVc(null);
                  setCaptain(p.id);
                } else if (!captainId) {
                  setCaptain(p.id);
                } else if (!vcId) {
                  setVc(p.id);
                } else {
                  // Replace VC
                  setVc(p.id);
                }
              }
              return (
                <PlayerRow
                  key={p.id}
                  player={p}
                  selected={isCap || isVc}
                  onClick={handleTap}
                  badge={isCap ? 'C' : isVc ? 'VC' : null}
                  badgeColor={isCap ? 'purple' : 'cyan'}
                  highlight={isCap ? 'captain' : isVc ? 'vc' : null}
                />
              );
            })}
          </div>
          <div className="picker-footer">
            <span className={captainId && vcId ? 'text-green' : 'text-secondary'}>
              {captainId ? '✓ C' : '— C'} · {vcId ? '✓ VC' : '— VC'}
            </span>
            <button
              className="btn btn-primary"
              disabled={!captainId || !vcId}
              onClick={() => setStep(3)}
            >
              Review →
            </button>
          </div>
        </>
      )}

      {/* ── STEP 3: Confirm ── */}
      {step === 3 && (
        <div className="container">
          <div className="confirm-section">
            <h3 className="confirm-title">Your XI</h3>
            {mainPlayers.map(p => (
              <div key={p.id} className="confirm-row">
                <span className="confirm-name">{p.name}</span>
                <span className="confirm-team text-muted text-sm">{p.team}</span>
                {captainId === p.id && <span className="badge badge-purple">C 2×</span>}
                {vcId === p.id && <span className="badge badge-cyan">VC 1.5×</span>}
              </div>
            ))}
          </div>

          <div className="confirm-section">
            <h3 className="confirm-title">Backups</h3>
            {backupPlayers.map((p, i) => (
              <div key={p.id} className="confirm-row">
                <span className="confirm-name">{p.name}</span>
                <span className="confirm-team text-muted text-sm">{p.team}</span>
                <span className="badge badge-gold">B{i + 1}</span>
              </div>
            ))}
          </div>

          {error && <p className="auth-error mt-4">{error}</p>}

          <button
            className="btn btn-primary btn-full mt-6"
            onClick={submit}
            disabled={saving}
          >
            {saving
              ? <span className="spinner" style={{width:18,height:18,borderWidth:2}} />
              : existing ? 'Update Team' : 'Submit Team'
            }
          </button>
        </div>
      )}
    </div>
  );
}

function PlayerRow({ player, selected, disabled, onClick, badge, badgeColor = 'cyan', highlight }) {
  return (
    <div
      className={`player-row ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''} ${highlight || ''}`}
      onClick={disabled ? undefined : onClick}
    >
      <div className="player-row-left">
        {badge && (
          <span className={`player-badge badge-${badgeColor}`}>{badge}</span>
        )}
        <div className="player-info">
          <span className="player-name">{player.name}</span>
          <span className="player-meta text-muted text-sm">
            {player.team}
            {player.role && ` · ${player.role}`}
            {player.is_playing_xi ? (
              <span className="xi-dot"> ✓</span>
            ) : null}
          </span>
        </div>
      </div>
      <div className={`player-check ${selected ? 'checked' : ''}`}>
        {selected && '✓'}
      </div>
    </div>
  );
}
