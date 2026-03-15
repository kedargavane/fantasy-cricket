import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api, { SOCKET_URL } from '../utils/api.js';
import Spinner from '../components/common/Spinner.jsx';
import './LiveScorePage.css';

const TABS = ['Leaderboard', 'Match Score', 'Compare', 'All Players'];

export default function LiveScorePage() {
  const { matchId } = useParams();
  const navigate    = useNavigate();
  const socketRef   = useRef(null);

  const [match, setMatch]       = useState(null);
  const [myTeam, setMyTeam]     = useState(null);
  const [scores, setScores]     = useState([]);
  const [leaderboard, setBoard] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [tab, setTab]           = useState(0);
  const [viewTeam, setViewTeam] = useState(null);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [compareA, setCompareA] = useState(0);
  const [compareB, setCompareB] = useState(0);

  useEffect(() => {
    loadData();
    setupSocket();
    return () => socketRef.current?.disconnect();
  }, [matchId]);

  async function loadUserTeam(userId, userName, totalPts) {
    setLoadingTeam(true);
    try {
      const res = await api.get(`/teams/user/${userId}/match/${matchId}`);
      setViewTeam({ name: userName, players: res.data.team.players, total: totalPts });
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
    try {
      const socket = io(SOCKET_URL, { transports: ['websocket'] });
      socketRef.current = socket;
      socket.emit('joinMatch', matchId);
      socket.on('statsUpdate', async () => {
        try {
          const [sRes, lRes] = await Promise.all([
            api.get(`/matches/${matchId}/scores`),
            api.get(`/matches/${matchId}/leaderboard`),
          ]);
          setScores(sRes.data.scores || []);
          setBoard(lRes.data.leaderboard || []);
          setLastUpdate(new Date());
        } catch {}
      });
    } catch {}
  }

  if (loading) return <Spinner center />;

  const scoreMap = {};
  scores.forEach(s => { scoreMap[s.player_id] = s; });

  // Build innings data from scores
  const innings = {};
  scores.forEach(s => {
    if (!innings[s.team]) innings[s.team] = { runs: 0, wickets: 0, batters: [], bowlers: [] };
    const t = innings[s.team];
    if ((s.runs > 0 || s.balls_faced > 0) && s.dismissal_type !== 'dnb') {
      t.runs += s.runs || 0;
      if (s.dismissal_type && !['notout','dnb',''].includes(s.dismissal_type)) t.wickets++;
      t.batters.push(s);
    }
    if (s.overs_bowled > 0) t.bowlers.push(s);
  });

  // View another user's team
  if (viewTeam) return (
    <div className="ls-page">
      <div className="ls-header">
        <button className="ls-back" onClick={() => setViewTeam(null)}>‹</button>
        <div className="ls-header-info">
          <span className="ls-header-title">{viewTeam.name}'s Team</span>
          <span className="ls-header-sub">{viewTeam.total} pts</span>
        </div>
      </div>
      <div className="ls-content">
        {loadingTeam
          ? <Spinner center />
          : <>
              {viewTeam.players.filter(p => !p.is_backup).map(p => (
                <PlayerRow key={p.id} player={p} pts={p.fantasy_points} role={p.role_in_team} isBackup={false} isPlaying={p.is_playing_xi} />
              ))}
              {viewTeam.players.some(p => p.is_backup) && (
                <div className="ls-section-label">Backups</div>
              )}
              {viewTeam.players.filter(p => p.is_backup).map(p => (
                <PlayerRow key={p.id} player={p} pts={p.fantasy_points} role={null} isBackup={true} isPlaying={p.is_playing_xi} />
              ))}
            </>
        }
      </div>
    </div>
  );

  return (
    <div className="ls-page">

      {/* Header */}
      <div className="ls-header">
        <button className="ls-back" onClick={() => navigate('/')}>‹</button>
        <div className="ls-header-info">
          <span className="ls-header-title">{match?.team_a} vs {match?.team_b}</span>
          <span className="ls-header-sub">
            {match?.status === 'live' && <span className="ls-live-dot">● </span>}
            {match?.status === 'live' ? 'Live' : match?.status}
            {lastUpdate && ` · ${lastUpdate.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}`}
          </span>
        </div>
        <div className="ls-header-actions">
          {match?.status === 'completed' && (
            <button className="ls-action-btn ls-result-btn" onClick={() => navigate(`/match/${matchId}/result`)}>Result</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="ls-tabs">
        {TABS.map((t, i) => (
          <button key={t} className={`ls-tab ${tab === i ? 'active' : ''}`} onClick={() => setTab(i)}>{t}</button>
        ))}
      </div>

      {/* Tab 0: Leaderboard */}
      {tab === 0 && (
        <div className="ls-content">
          {/* Match score summary */}
          {Object.keys(innings).length > 0 && (
            <div className="ls-match-summary">
              {Object.entries(innings).map(([team, data]) => (
                <div key={team} className="ls-summary-team">
                  <span className="ls-summary-name">{team}</span>
                  <span className="ls-summary-score">{data.runs}/{data.wickets}</span>
                </div>
              ))}
            </div>
          )}
          {leaderboard.length === 0
            ? <div className="ls-empty">No entries yet</div>
            : leaderboard.map((entry, i) => (
                <div key={entry.user_id} className="ls-lb-row" onClick={() => loadUserTeam(entry.user_id, entry.name, entry.total_fantasy_points)}>
                  <span className="ls-lb-rank">
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}
                  </span>
                  <span className="ls-lb-name">{entry.name}</span>
                  <span className="ls-lb-pts">{entry.total_fantasy_points}</span>
                  <span className="ls-lb-chevron">›</span>
                </div>
              ))
          }
        </div>
      )}

      {/* Tab 1: Match Score */}
      {tab === 1 && (
        <div className="ls-content">
          {Object.keys(innings).length === 0
            ? <div className="ls-empty">Scores not available yet</div>
            : Object.entries(innings).map(([team, data]) => (
                <div key={team} className="ls-innings">
                  <div className="ls-innings-header">
                    <span className="ls-innings-team">{team}</span>
                    <span className="ls-innings-score">{data.runs}/{data.wickets}</span>
                  </div>
                  {data.batters.length > 0 && (
                    <>
                      <div className="ls-sc-section">Batting</div>
                      <table className="ls-sc-table">
                        <thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th></tr></thead>
                        <tbody>
                          {data.batters.sort((a,b)=>(b.runs||0)-(a.runs||0)).map(p => (
                            <tr key={p.player_id}>
                              <td>{p.name}{p.dismissal_type==='notout'?' *':''}</td>
                              <td className={p.runs>=50?'ls-highlight':''}>{p.runs||0}</td>
                              <td>{p.balls_faced||0}</td>
                              <td>{p.fours||0}</td>
                              <td>{p.sixes||0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                  {data.bowlers.length > 0 && (
                    <>
                      <div className="ls-sc-section">Bowling</div>
                      <table className="ls-sc-table">
                        <thead><tr><th>Bowler</th><th>O</th><th>W</th><th>R</th><th>Eco</th></tr></thead>
                        <tbody>
                          {data.bowlers.sort((a,b)=>(b.wickets||0)-(a.wickets||0)).map(p => (
                            <tr key={p.player_id}>
                              <td>{p.name}</td>
                              <td>{p.overs_bowled||0}</td>
                              <td className={p.wickets>0?'ls-highlight':''}>{p.wickets||0}</td>
                              <td>{p.runs_conceded||0}</td>
                              <td>{p.overs_bowled>0?(p.runs_conceded/p.overs_bowled).toFixed(1):'-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              ))
          }
        </div>
      )}

      {/* Tab 2: Compare */}
      {tab === 2 && (
        <div className="ls-content">
          <div className="ls-compare-selectors">
            <select className="ls-compare-select" value={compareA} onChange={e => setCompareA(parseInt(e.target.value))}>
              <option value={0}>Select player A</option>
              {leaderboard.map(e => <option key={e.user_id} value={e.user_id}>{e.name} ({e.total_fantasy_points}pts)</option>)}
            </select>
            <span className="ls-compare-vs">VS</span>
            <select className="ls-compare-select" value={compareB} onChange={e => setCompareB(parseInt(e.target.value))}>
              <option value={0}>Select player B</option>
              {leaderboard.map(e => <option key={e.user_id} value={e.user_id}>{e.name} ({e.total_fantasy_points}pts)</option>)}
            </select>
          </div>
          {compareA && compareB && compareA !== compareB
            ? <button className="btn btn-primary btn-full mt-3" onClick={() => navigate(`/match/${matchId}/compare?userA=${compareA}&userB=${compareB}`)}>
                Compare Teams →
              </button>
            : <div className="ls-empty" style={{paddingTop:16}}>Select two players above to compare</div>
          }
        </div>
      )}

      {/* Tab 3: All Players */}
      {tab === 3 && (
        <div className="ls-content">
          {scores.length === 0
            ? <div className="ls-empty">No player scores yet</div>
            : scores.map(p => (
                <PlayerRow key={p.player_id}
                  player={{name:p.name,team:p.team,id:p.player_id}}
                  pts={p.fantasy_points} role={null} isBackup={false} isPlaying={p.is_playing_xi} />
              ))
          }
        </div>
      )}

    </div>
  );
}

function PlayerRow({ player, pts, role, isBackup, isPlaying }) {
  const multi = role === 'captain' ? 2 : role === 'vc' ? 1.5 : 1;
  const total = pts !== undefined ? Math.round(pts * multi) : undefined;
  return (
    <div className={`ls-player-row ${isBackup ? 'ls-backup' : ''} ${isPlaying === false ? 'ls-not-playing' : ''}`}>
      <div className="ls-player-left">
        {role === 'captain' && <span className="ls-badge ls-cap">C</span>}
        {role === 'vc'      && <span className="ls-badge ls-vc">V</span>}
        {!role              && <span className="ls-badge-empty" />}
        <div className="ls-player-info">
          <span className="ls-player-name">{player.name}</span>
          <span className="ls-player-team">{player.team}{isPlaying === false ? ' · not playing' : ''}</span>
        </div>
      </div>
      <span className={`ls-player-pts ${total > 0 ? 'ls-pts-active' : ''}`}>
        {total !== undefined ? total : '—'}
      </span>
    </div>
  );
}
