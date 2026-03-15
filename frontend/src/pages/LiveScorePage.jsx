import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api, { SOCKET_URL } from '../utils/api.js';
import Spinner from '../components/common/Spinner.jsx';
import './LiveScorePage.css';

const TABS = ['My Team', 'Match Score', 'All Players', 'Leaderboard'];

export default function LiveScorePage() {
  const { matchId }  = useParams();
  const navigate     = useNavigate();
  const socketRef    = useRef(null);

  const [match, setMatch]       = useState(null);
  const [myTeam, setMyTeam]     = useState(null);
  const [scores, setScores]     = useState([]);
  const [leaderboard, setBoard] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [tab, setTab]           = useState(0);
  const [viewTeam, setViewTeam] = useState(null);
  const [loadingTeam, setLoadingTeam] = useState(false);

  useEffect(() => {
    loadData();
    setupSocket();
    return () => socketRef.current?.disconnect();
  }, [matchId]);

  async function loadUserTeam(userId, userName) {
    setLoadingTeam(true);
    try {
      const res = await api.get(`/teams/user/${userId}/match/${matchId}`);
      setViewTeam({ name: userName, players: res.data.team.players, total: res.data.team.total_fantasy_points });
    } catch {}
    finally { setLoadingTeam(false); }
  }

  async function loadData() {
    try {
      const [sRes, lRes] = await Promise.all([
        api.get(`/matches/${matchId}/scores`),
        api.get(`/matches/${matchId}/leaderboard`),
      ]);
      setMatch(sRes.data.match);
      setScores(sRes.data.scores || []);
      setBoard(lRes.data.leaderboard || []);
      setLastUpdate(new Date());
      try {
        const tRes = await api.get(`/teams/match/${matchId}`);
        setMyTeam(tRes.data.team);
      } catch {}
    } catch {}
    finally { setLoading(false); }
  }

  function setupSocket() {
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;
    socket.emit('joinMatch', matchId);
    socket.on('statsUpdate', async () => {
      const [sRes, lRes] = await Promise.all([
        api.get(`/matches/${matchId}/scores`),
        api.get(`/matches/${matchId}/leaderboard`),
      ]);
      setScores(sRes.data.scores || []);
      setBoard(lRes.data.leaderboard || []);
      setLastUpdate(new Date());
    });
  }

  if (loading) return <Spinner center />;

  // User team view
  if (viewTeam) return (
    <div className="page" style={{paddingBottom:80}}>
      <div style={{display:'flex',alignItems:'center',gap:12,padding:'10px 16px',background:'var(--bg-surface)',borderBottom:'1px solid var(--border)',position:'sticky',top:0,zIndex:20}}>
        <button className="btn-back" onClick={() => setViewTeam(null)}>‹</button>
        <div style={{flex:1}}>
          <div style={{fontSize:'0.9rem',fontWeight:600}}>{viewTeam.name}'s Team</div>
          <div style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>{viewTeam.total} pts</div>
        </div>
      </div>
      <div style={{padding:'0 16px'}}>
        {viewTeam.players.filter(p => !p.is_backup).map(p => (
          <PlayerScoreRow key={p.id} player={p} stats={{fantasy_points:p.fantasy_points,is_playing_xi:p.is_playing_xi}} pts={p.fantasy_points} role={p.role_in_team} isBackup={false} />
        ))}
        {viewTeam.players.some(p => p.is_backup) && (
          <p style={{fontSize:'0.75rem',color:'var(--text-muted)',margin:'12px 0 4px',textTransform:'uppercase',letterSpacing:'0.05em'}}>Backups</p>
        )}
        {viewTeam.players.filter(p => p.is_backup).map(p => (
          <PlayerScoreRow key={p.id} player={p} stats={{fantasy_points:p.fantasy_points,is_playing_xi:p.is_playing_xi}} pts={p.fantasy_points} role={p.role_in_team} isBackup={true} />
        ))}
      </div>
    </div>
  );

  const scoreMap = {};
  scores.forEach(s => { scoreMap[s.player_id] = s; });

  // Innings from scores
  const innings = {};
  scores.forEach(s => {
    if (!innings[s.team]) innings[s.team] = { runs:0, wickets:0, overs:0, batters:[], bowlers:[] };
    const t = innings[s.team];
    if (s.runs > 0 || s.balls_faced > 0) {
      t.runs += s.runs || 0;
      if (s.dismissal_type && s.dismissal_type !== 'notout' && s.dismissal_type !== 'dnb') t.wickets++;
      t.batters.push(s);
    }
    if (s.overs_bowled > 0) t.bowlers.push(s);
  });

  return (
    <div className="live-page">
      {/* Header */}
      <div className="live-header">
        <div className="live-header-top">
          <button className="btn-back" onClick={() => navigate('/')}>‹</button>
          <div className="live-match-info">
            <span className="live-teams">{match?.team_a} vs {match?.team_b}</span>
            {match?.status === 'live' && <span className="live-badge">● LIVE</span>}
          </div>
          <div style={{display:'flex',gap:6}}>
            {(match?.status === 'live' || match?.status === 'completed') && (
              <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/match/${matchId}/compare`)}>⚔</button>
            )}
            {match?.status === 'completed' && (
              <button className="btn btn-sm btn-secondary" onClick={() => navigate(`/match/${matchId}/result`)}>Result</button>
            )}
          </div>
        </div>
        {lastUpdate && (
          <div className="live-updated">Updated {lastUpdate.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div>
        )}
      </div>

      {/* Tabs */}
      <div className="live-tabs">
        {TABS.map((t, i) => (
          <button key={t} className={`tab ${tab === i ? 'active' : ''}`} onClick={() => setTab(i)}>{t}</button>
        ))}
      </div>

      {/* Tab 0: My Team */}
      {tab === 0 && (
        <div className="live-tab-content">
          {!myTeam ? (
            <div className="card text-center text-secondary mt-4">
              <p>You haven't picked a team for this match.</p>
              {match?.status === 'upcoming' && (
                <button className="btn btn-primary mt-3" onClick={() => navigate(`/match/${matchId}/pick`)}>Pick Team</button>
              )}
            </div>
          ) : (
            <>
              <div className="my-team-score card mb-3">
                <span className="text-secondary text-sm">My score</span>
                <span className="live-pts">{myTeam.total_fantasy_points || 0} pts</span>
              </div>
              {myTeam.players?.filter(p => !p.is_backup).map(p => {
                const s = scoreMap[p.id];
                const role = p.id === (myTeam.resolved_captain_id || myTeam.captain_id) ? 'captain'
                           : p.id === (myTeam.resolved_vice_captain_id || myTeam.vice_captain_id) ? 'vc' : null;
                return <PlayerScoreRow key={p.id} player={p} stats={s} pts={s?.fantasy_points} role={role} isBackup={false} />;
              })}
              {myTeam.players?.some(p => p.is_backup) && (
                <p className="text-muted text-sm mt-3 mb-2" style={{textTransform:'uppercase',letterSpacing:'0.05em'}}>Backups</p>
              )}
              {myTeam.players?.filter(p => p.is_backup).map(p => {
                const s = scoreMap[p.id];
                return <PlayerScoreRow key={p.id} player={p} stats={s} pts={s?.fantasy_points} role={null} isBackup={true} />;
              })}
            </>
          )}
        </div>
      )}

      {/* Tab 1: Match Score */}
      {tab === 1 && (
        <div className="live-tab-content">
          {scores.length === 0 ? (
            <div className="card text-center text-secondary mt-4">Match scores not available yet</div>
          ) : (
            Object.entries(innings).map(([team, data]) => (
              <div key={team} className="card mb-3">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                  <span style={{fontWeight:600,fontSize:'0.9rem'}}>{team}</span>
                  <span style={{fontFamily:'var(--font-mono)',fontSize:'1rem',fontWeight:700,color:'var(--accent-primary)'}}>
                    {data.runs}/{data.wickets}
                  </span>
                </div>
                {/* Batting */}
                {data.batters.length > 0 && (
                  <>
                    <div style={{display:'grid',gridTemplateColumns:'1fr auto auto auto auto',gap:'4px 8px',fontSize:'0.72rem',color:'var(--text-muted)',marginBottom:4,borderBottom:'1px solid var(--border)',paddingBottom:4}}>
                      <span>Batter</span><span>R</span><span>B</span><span>4s</span><span>6s</span>
                    </div>
                    {data.batters.sort((a,b) => (b.runs||0)-(a.runs||0)).map(p => (
                      <div key={p.player_id} style={{display:'grid',gridTemplateColumns:'1fr auto auto auto auto',gap:'4px 8px',fontSize:'0.75rem',padding:'3px 0',borderBottom:'0.5px solid var(--border)'}}>
                        <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}{p.dismissal_type==='notout'?' *':''}</span>
                        <span style={{fontFamily:'var(--font-mono)',fontWeight:600}}>{p.runs||0}</span>
                        <span style={{fontFamily:'var(--font-mono)',color:'var(--text-muted)'}}>{p.balls_faced||0}</span>
                        <span style={{fontFamily:'var(--font-mono)',color:'var(--text-muted)'}}>{p.fours||0}</span>
                        <span style={{fontFamily:'var(--font-mono)',color:'var(--text-muted)'}}>{p.sixes||0}</span>
                      </div>
                    ))}
                  </>
                )}
                {/* Bowling */}
                {data.bowlers.length > 0 && (
                  <>
                    <div style={{display:'grid',gridTemplateColumns:'1fr auto auto auto',gap:'4px 8px',fontSize:'0.72rem',color:'var(--text-muted)',margin:'8px 0 4px',borderBottom:'1px solid var(--border)',paddingBottom:4}}>
                      <span>Bowler</span><span>O</span><span>W</span><span>R</span>
                    </div>
                    {data.bowlers.sort((a,b) => (b.wickets||0)-(a.wickets||0)).map(p => (
                      <div key={p.player_id} style={{display:'grid',gridTemplateColumns:'1fr auto auto auto',gap:'4px 8px',fontSize:'0.75rem',padding:'3px 0',borderBottom:'0.5px solid var(--border)'}}>
                        <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</span>
                        <span style={{fontFamily:'var(--font-mono)',color:'var(--text-muted)'}}>{p.overs_bowled||0}</span>
                        <span style={{fontFamily:'var(--font-mono)',fontWeight:600,color:p.wickets>0?'var(--accent-green)':'inherit'}}>{p.wickets||0}</span>
                        <span style={{fontFamily:'var(--font-mono)',color:'var(--text-muted)'}}>{p.runs_conceded||0}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab 2: All Players */}
      {tab === 2 && (
        <div className="live-tab-content">
          {scores.length === 0 ? (
            <div className="card text-center text-secondary mt-4">No player scores yet</div>
          ) : (
            scores.map(p => (
              <PlayerScoreRow key={p.player_id} player={{name:p.name,team:p.team,role:p.role,id:p.player_id}} stats={p} pts={p.fantasy_points} role={null} isBackup={false} />
            ))
          )}
        </div>
      )}

      {/* Tab 3: Leaderboard */}
      {tab === 3 && (
        <div className="live-tab-content">
          {/* Match score summary */}
          {scores.length > 0 && (
            <div className="lb-score-header card mb-3">
              {Object.entries(innings).map(([team, data]) => (
                <div key={team} className="lb-score-team">
                  <span className="lb-score-name">{team}</span>
                  <span className="lb-score-runs">{data.runs}/{data.wickets}</span>
                </div>
              ))}
            </div>
          )}
          {leaderboard.map((entry, i) => (
            <div
              key={entry.user_id}
              className="lb-row card mb-2 lb-row-clickable"
              onClick={() => loadUserTeam(entry.user_id, entry.name)}
            >
              <span className="lb-rank mono">
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}
              </span>
              <div className="lb-info">
                <span className="player-name">{entry.name}</span>
              </div>
              <span className="lb-pts text-cyan mono font-bold">{entry.total_fantasy_points}</span>
              <span className="lb-chevron">›</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerScoreRow({ player, stats, pts, role, isBackup }) {
  const base  = stats?.fantasy_points || 0;
  const multi = role === 'captain' ? 2 : role === 'vc' ? 1.5 : 1;
  const total = Math.round(base * multi);
  return (
    <div className={`player-score-row ${isBackup ? 'backup-row' : ''} ${stats?.is_playing_xi === false ? 'not-playing' : ''}`}>
      <div className="psr-left">
        {role === 'captain' && <span className="role-badge captain-badge">C</span>}
        {role === 'vc'      && <span className="role-badge vc-badge">VC</span>}
        {!role              && <span className="role-badge empty-badge" />}
        <div>
          <span className="player-name">{player.name}</span>
          <span className="text-muted text-sm"> {player.team}</span>
          {stats?.is_playing_xi === false && <span className="not-playing-label"> · Not playing</span>}
        </div>
      </div>
      <div className="psr-right">
        {stats?.runs > 0 && <span className="stat-pill">{stats.runs}r</span>}
        {stats?.wickets > 0 && <span className="stat-pill">{stats.wickets}w</span>}
        <span className={`psr-pts ${total > 0 ? 'text-cyan' : 'text-muted'}`}>{pts !== undefined ? total : '—'}</span>
      </div>
    </div>
  );
}
