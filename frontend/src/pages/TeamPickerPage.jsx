import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../utils/api.js';
import Spinner from '../components/common/Spinner.jsx';
import './TeamPickerPage.css';

function useCountdown(targetISO, matchStatus) {
  const [timeLeft, setTimeLeft] = useState('');
  const [urgent, setUrgent]     = useState(false);
  useEffect(() => {
    if (!targetISO) return;
    function tick() {
      const diff = new Date(targetISO) - new Date();
      if (diff <= 0) {
        // Past scheduled time but not live yet = delayed
        setTimeLeft('Delayed');
        setUrgent(false);
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setUrgent(diff < 15 * 60000);
      setTimeLeft(h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetISO]);
  return { timeLeft, urgent };
}

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
  return parts.length === 1 ? name : parts[parts.length - 1];
}

function matchTeamName(playerTeam, matchTeam) {
  if (!playerTeam || !matchTeam) return false;
  const p = playerTeam.toLowerCase().trim();
  const m = matchTeam.toLowerCase().trim();
  return p === m || p.includes(m) || m.includes(p);
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
  const [filter, setFilter]       = useState('ALL');
  const [sortByPts, setSortByPts] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerStats, setPlayerStats]       = useState(null);
  const [loadingStats, setLoadingStats]     = useState(false);

  const [mainIds,   setMainIds]   = useState(new Set());
  const [backupIds, setBackupIds] = useState(new Set());
  const [captainId, setCaptain]   = useState(null);
  const [vcId,      setVc]        = useState(null);
  const { timeLeft, urgent } = useCountdown(match?.start_time, match?.status);

  useEffect(() => { loadData(); }, [matchId]);

  // Listen for match status changes (start / delay)
  useEffect(() => {
    if (!matchId) return;
    const socket = io(import.meta.env.VITE_API_URL || '');
    socket.emit('joinMatch', parseInt(matchId));
    socket.on('matchStarted', () => {
      setMatch(prev => prev ? { ...prev, status: 'live' } : prev);
    });
    socket.on('matchDelayed', () => {
      setMatch(prev => prev ? { ...prev, status: 'upcoming' } : prev);
    });
    return () => socket.disconnect();
  }, [matchId]);

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
        const mains = new Set(t.players.filter(p => !p.is_backup).map(p => p.id));
        const baks  = new Set(t.players.filter(p =>  p.is_backup).map(p => p.id));
        setMainIds(mains);
        setBackupIds(baks);
        setCaptain(t.captain_id);
        setVc(t.vice_captain_id);
      } catch {}
    } catch {
      setError('Failed to load squad');
    } finally {
      setLoading(false);
    }
  }

  // Split squad into two columns using match team names as anchors
  // This handles any variation in how Sportmonks returns team names
  const { teamA, teamB, playersA, playersB } = useMemo(() => {
    if (!match || squad.length === 0) return { teamA: '', teamB: '', playersA: [], playersB: [] };

    const tA = match.team_a;
    const tB = match.team_b;

    // Try exact match first
    let pA = squad.filter(p => p.team === tA);
    let pB = squad.filter(p => p.team === tB);

    // Fuzzy match if exact fails
    if (pA.length === 0 || pB.length === 0) {
      pA = squad.filter(p => matchTeamName(p.team, tA));
      pB = squad.filter(p => matchTeamName(p.team, tB));
    }

    // If still empty (team field blank in DB) — split by position
    // First half = team A, second half = team B (Sportmonks returns them grouped)
    if (pA.length === 0 && pB.length === 0) {
      const half = Math.ceil(squad.length / 2);
      pA = squad.slice(0, half);
      pB = squad.slice(half);
    }

    return { teamA: tA, teamB: tB, playersA: pA, playersB: pB };
  }, [match, squad]);

  const mainCount   = mainIds.size;
  const backupCount = backupIds.size;

  function applyRoleFilter(players) {
    let result = filter === 'ALL' ? players : players.filter(p => {
      const r = normaliseRole(p.role);
      if (filter === 'BAT')  return r === 'Bat';
      if (filter === 'BOWL') return r === 'Bowl';
      if (filter === 'AR')   return r === 'AR';
      if (filter === 'WK')   return r === 'WK';
      return true;
    });
    if (sortByPts) result = [...result].sort((a, b) => (b.season_pts || 0) - (a.season_pts || 0));
    return result;
  }

  async function loadPlayerStats(player) {
    setSelectedPlayer(player);
    setPlayerStats(null);
    setLoadingStats(true);
    try {
      const seasonId = match?.season_id;
      const res = await api.get(`/matches/player/${player.id}/season/${seasonId}/stats`);
      setPlayerStats(res.data);
    } catch {}
    finally { setLoadingStats(false); }
  }

  function toggleMain(playerId) {
    if (backupIds.has(playerId)) return;
    if (mainIds.has(playerId)) {
      if (captainId === playerId) setCaptain(null);
      if (vcId === playerId) setVc(null);
      setMainIds(s => { const n = new Set(s); n.delete(playerId); return n; });
    } else {
      if (mainCount >= 11) return;
      setMainIds(s => new Set([...s, playerId]));
    }
  }

  function toggleBackup(playerId) {
    if (mainIds.has(playerId)) return;
    if (backupIds.has(playerId)) {
      setBackupIds(s => { const n = new Set(s); n.delete(playerId); return n; });
    } else {
      if (backupCount >= 2) return;
      setBackupIds(s => new Set([...s, playerId]));
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

  const matchLocked = match?.status === 'live' || match?.status === 'completed';
  const canSubmit = !matchLocked && mainCount === 11 && captainId && vcId;
  const statusText = !canSubmit
    ? mainCount < 11 ? `${11 - mainCount} more to pick`
    : !captainId     ? 'Pick a captain'
    : 'Pick a VC'
    : '';

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      const mainArr   = squad.filter(p => mainIds.has(p.id)).map(p => p.id);
      const backupArr = squad.filter(p => backupIds.has(p.id)).map(p => p.id);
      const payload   = { playerIds: mainArr, backupIds: backupArr, captainId, viceCaptainId: vcId };
      if (existing) {
        await api.put(`/teams/${existing.id}`, payload);
      } else {
        try {
          await api.post(`/teams/match/${matchId}`, payload);
        } catch (postErr) {
          // If already exists, fetch the team ID and use PUT instead
          if (postErr.response?.data?.error?.includes('already')) {
            const tRes = await api.get(`/teams/match/${matchId}`);
            const t = tRes.data.team;
            setExisting(t);
            await api.put(`/teams/${t.id}`, payload);
          } else {
            throw postErr;
          }
        }
      }
      navigate(`/match/${matchId}/live`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save team');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner center />;

  // Sort: XI confirmed first, then non-XI, within each group keep original order
  function sortByXI(players) {
    const xi    = players.filter(p => p.is_playing_xi);
    const nonXI = players.filter(p => !p.is_playing_xi);
    return [...xi, ...nonXI];
  }

  const colA = applyRoleFilter(sortByXI(playersA));
  const colB = applyRoleFilter(sortByXI(playersB));
  const colAMain = playersA.filter(p => mainIds.has(p.id)).length;
  const colBMain = playersB.filter(p => mainIds.has(p.id)).length;

  return (
    <div className="picker-page">

      {/* Top bar */}
      <div className="picker-topbar">
        <button className="btn-back" onClick={() => navigate(-1)}>‹</button>
        <div className="picker-topbar-center">
          <span className="picker-topbar-title">Pick your team</span>
          <span className="picker-topbar-match">{match?.team_a} vs {match?.team_b}</span>
          {match?.venue_info && (
            <span style={{fontSize:'0.65rem',color:'var(--text-muted)'}}>{match.venue_info}</span>
          )}
          {match?.status === 'live' || match?.status === 'completed' ? (
            <span className="picker-countdown" style={{color:'#f87171'}}>
              Team locked
            </span>
          ) : timeLeft === 'Delayed' ? (
            <span className="picker-countdown" style={{color:'var(--accent-gold)'}}>
              Delayed — team still open
            </span>
          ) : timeLeft ? (
            <span className={`picker-countdown ${urgent ? 'countdown-urgent' : ''}`}>
              Locks in {timeLeft}
            </span>
          ) : null}
        </div>
        <div className="picker-counters">
          <span className={`picker-counter ${mainCount === 11 ? 'counter-done' : ''}`}>{mainCount}/11</span>
          <span className={`picker-counter counter-bak ${backupCount === 2 ? 'counter-done' : ''}`}>{backupCount}/2</span>
          <button
            className={`header-submit-btn ${canSubmit ? 'header-submit-ready' : ''}`}
            disabled={!canSubmit || saving}
            onClick={submit}
          >
            {saving
              ? <span className="spinner" style={{width:12,height:12,borderWidth:2}} />
              : existing ? (canSubmit ? 'Update ✓' : !captainId ? 'Pick C' : 'Pick VC')
                         : (canSubmit ? 'Submit ✓' : !captainId ? 'Pick C' : 'Pick VC')
            }
          </button>
        </div>
      </div>

      {/* Role filters + sort */}
      <div className="picker-filters" style={{display:'flex',alignItems:'center'}}>
        <div style={{display:'flex',flex:1,overflowX:'auto',gap:4}}>
          {ROLE_FILTERS.map(f => (
            <button key={f.key} className={`filter-btn ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <button
          className={`filter-btn ${sortByPts ? 'active' : ''}`}
          onClick={() => setSortByPts(s => !s)}
          style={{flexShrink:0,marginLeft:4}}
        >
          {sortByPts ? '↓ Pts' : 'Sort'}
        </button>
      </div>

      {/* Legend */}
      <div className="picker-legend">
        <span className="leg-item"><span className="leg-pip pip-xi" />XI</span>
        <span className="leg-item"><span className="leg-pip pip-main" />Main</span>
        <span className="leg-item"><span className="leg-pip pip-bak" />Backup</span>
        <span className="leg-cap-item"><span className="leg-cap">C</span>2× &nbsp;<span className="leg-vc">VC</span>1.5×</span>
      </div>

      {/* Two columns — explicitly rendered, no dynamic split */}
      <div className="picker-grid">

        {/* Column A */}
        <div className="picker-col">
          <div className="picker-col-hdr">
            <span className="picker-col-name">{teamA}</span>
            <span className="picker-col-count">{colAMain} picked</span>
          </div>
          {colA.length === 0 && <div className="picker-empty">No players</div>}
          {colA.map(p => <PlayerRow key={p.id} p={p} mainIds={mainIds} backupIds={backupIds} captainId={captainId} vcId={vcId} mainCount={mainCount} backupCount={backupCount} toggleMain={toggleMain} toggleBackup={toggleBackup} handleCaptain={handleCaptain} handleVc={handleVc} onInfo={loadPlayerStats} />)}
        </div>

        {/* Column B */}
        <div className="picker-col">
          <div className="picker-col-hdr">
            <span className="picker-col-name">{teamB}</span>
            <span className="picker-col-count">{colBMain} picked</span>
          </div>
          {colB.length === 0 && <div className="picker-empty">No players</div>}
          {colB.map(p => <PlayerRow key={p.id} p={p} mainIds={mainIds} backupIds={backupIds} captainId={captainId} vcId={vcId} mainCount={mainCount} backupCount={backupCount} toggleMain={toggleMain} toggleBackup={toggleBackup} handleCaptain={handleCaptain} handleVc={handleVc} onInfo={loadPlayerStats} />)}
        </div>

      </div>

      {/* Tray */}
      <div className="picker-tray">
        <div className="tray-header">
          <span className="tray-title">Your team</span>
          {statusText && <span className="tray-hint">{statusText}</span>}
        </div>
        <div className="tray-chips">
          {squad.filter(p => mainIds.has(p.id)).map(p => (
            <span key={p.id} className={`tray-chip ${captainId === p.id ? 'chip-cap' : vcId === p.id ? 'chip-vc' : 'chip-main'}`}>
              {shortName(p.name)}{captainId === p.id ? ' C' : vcId === p.id ? ' VC' : ''}
            </span>
          ))}
          {squad.filter(p => backupIds.has(p.id)).map((p, i) => (
            <span key={p.id} className="tray-chip chip-bak">{shortName(p.name)} B{i+1}</span>
          ))}
          {mainCount === 0 && <span className="tray-empty">Tap + to select players</span>}
        </div>
        {error && <p className="auth-error">{error}</p>}
        {matchLocked ? (
          <div style={{background:'rgba(248,113,113,0.1)',border:'1px solid rgba(248,113,113,0.3)',borderRadius:8,padding:'10px 14px',textAlign:'center',color:'#f87171',fontSize:'0.85rem',fontWeight:600}}>
            Match has started — team is locked
          </div>
        ) : (
          <div className="tray-submit-row">
            <span className="tray-status text-sm">
              {canSubmit
                ? <span style={{color:'var(--accent-green)'}}>Ready to submit!</span>
                : <span style={{color:'var(--accent-gold)'}}>{statusText}</span>
              }
            </span>
            <button className="btn btn-primary tray-submit-btn" disabled={!canSubmit || saving} onClick={submit}>
              {saving ? <span className="spinner" style={{width:14,height:14,borderWidth:2}} /> : existing ? 'Update ✓' : 'Submit Team ✓'}
            </button>
          </div>
        )}
      </div>

    </div>

    {/* Player stats detail screen */}
    {selectedPlayer && (
      <div style={{position:'fixed',inset:0,background:'var(--bg-base)',zIndex:200,display:'flex',flexDirection:'column'}}>
        <div style={{padding:'12px 16px',borderBottom:'0.5px solid var(--border)',display:'flex',alignItems:'center',gap:10,background:'var(--bg-surface)'}}>
          <button onClick={() => { setSelectedPlayer(null); setPlayerStats(null); }} style={{background:'none',border:'none',color:'var(--text-secondary)',fontSize:22,cursor:'pointer',padding:0,lineHeight:1}}>‹</button>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:600,color:'var(--text-primary)'}}>{selectedPlayer.name}</div>
            <div style={{fontSize:10,color:'var(--text-muted)',marginTop:1}}>{selectedPlayer.team} · {normaliseRole(selectedPlayer.role)}</div>
          </div>
        </div>
        {loadingStats
          ? <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}><div className="spinner" /></div>
          : playerStats ? (<>
              <div style={{padding:'14px 16px',borderBottom:'0.5px solid var(--border)',background:'var(--bg-elevated)'}}>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
                  {[
                    {label:'total pts', value: playerStats.totalPts,    color:'var(--accent-primary)'},
                    {label:'avg pts',   value: playerStats.avgPts,      color:'var(--accent-primary)'},
                    {label:'best',      value: playerStats.bestPts,     color:'var(--accent-gold)'},
                    {label:'matches',   value: playerStats.totalMatches, color:'var(--text-primary)'},
                  ].map(s => (
                    <div key={s.label} style={{background:'var(--bg-surface)',border:'0.5px solid var(--border)',borderRadius:6,padding:'8px 4px',textAlign:'center'}}>
                      <div style={{fontSize:9,color:'var(--text-muted)',marginBottom:3}}>{s.label}</div>
                      <div style={{fontSize:18,fontWeight:700,color:s.color}}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{flex:1,overflowY:'auto',padding:'12px 16px'}}>
                <div style={{fontSize:9,color:'var(--text-muted)',letterSpacing:'0.06em',marginBottom:8}}>LAST {playerStats.last5.length} MATCHES THIS SEASON</div>
                {playerStats.last5.length === 0
                  ? <div style={{color:'var(--text-muted)',fontSize:13,textAlign:'center',marginTop:40}}>No matches played yet this season</div>
                  : playerStats.last5.map((m, i) => (
                    <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 0',borderBottom:'0.5px solid var(--border)'}}>
                      <div style={{flex:1}}>
                        <div style={{fontSize:11,color:'var(--text-secondary)'}}>{m.team_a} vs {m.team_b}</div>
                        <div style={{fontSize:9,color:'var(--text-muted)',marginTop:3}}>
                          {[m.runs>0&&m.runs+'r', m.balls_faced>0&&m.balls_faced+'b', m.fours>0&&m.fours+'x4', m.sixes>0&&m.sixes+'x6', m.wickets>0&&m.wickets+'w', m.catches>0&&m.catches+'ct', m.stumpings>0&&m.stumpings+'st', m.run_outs>0&&m.run_outs+'ro'].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <div style={{fontSize:16,fontWeight:700,color:m.fantasy_points>=60?'var(--accent-primary)':m.fantasy_points>=30?'var(--text-secondary)':'var(--text-muted)'}}>
                        {m.fantasy_points}
                      </div>
                    </div>
                  ))
                }
              </div>
            </>)
          : <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-muted)',fontSize:13}}>No data</div>
        }
      </div>
    )}

  );
}

function PlayerRow({ p, mainIds, backupIds, captainId, vcId, mainCount, backupCount, toggleMain, toggleBackup, handleCaptain, handleVc, onInfo }) {
  const isMain  = mainIds.has(p.id);
  const isBak   = backupIds.has(p.id);
  const isCap   = captainId === p.id;
  const isVc    = vcId === p.id;
  const mainFull = !isMain && !isBak && mainCount >= 11;
  const bakFull  = !isBak && backupCount >= 2;

  return (
    <div className={`prow ${isMain ? 'prow-main' : ''} ${isBak ? 'prow-bak' : ''} ${isCap ? 'prow-cap' : ''} ${isVc ? 'prow-vc' : ''}`}>
      <div className="prow-left">
        <span className={`pip ${p.is_playing_xi ? 'pip-xi-sm' : 'pip-empty'}`} />
        <div className="prow-info" onClick={() => onInfo && onInfo(p)} style={{cursor:'pointer'}}>
          <span className="prow-name">{p.name}</span>
          <div style={{display:'flex',gap:6,alignItems:'center',marginTop:1}}>
            <span className="prow-role">{normaliseRole(p.role)}</span>
            {p.season_pts > 0 && <>
              <span style={{fontSize:'9px',color:'var(--accent-primary)',fontWeight:600}}>{p.season_pts}pts</span>
              <span style={{fontSize:'9px',color:'var(--text-muted)'}}>{p.season_avg}avg</span>
            </>}
            {(p.season_pts === 0 || p.season_pts === undefined) && <span style={{fontSize:'9px',color:'var(--text-muted)'}}>0pts</span>}
          </div>
        </div>
      </div>
      <div className="prow-right">
        {isMain && (
          <>
            <button className={`role-btn ${isCap ? 'role-btn-cap' : ''}`} onClick={e => handleCaptain(e, p.id)}>C</button>
            <button className={`role-btn ${isVc ? 'role-btn-vc' : ''}`} onClick={e => handleVc(e, p.id)} disabled={isCap}>VC</button>
          </>
        )}
        <button
          className={`sel-btn ${isMain ? 'sel-btn-main' : ''} ${mainFull ? 'sel-btn-dim' : ''}`}
          onClick={() => toggleMain(p.id)}
          disabled={isBak || mainFull}
        >{isMain ? '✓' : '+'}</button>
        {!isMain && (
          <button
            className={`sel-btn sel-btn-bak-toggle ${isBak ? 'sel-btn-bak-on' : ''} ${bakFull && !isBak ? 'sel-btn-dim' : ''}`}
            onClick={() => toggleBackup(p.id)}
            disabled={bakFull && !isBak}
          >{isBak ? 'B✓' : 'B'}</button>
        )}
      </div>
    </div>
  );
}
