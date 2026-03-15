import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api, { SOCKET_URL } from '../utils/api.js';
import Spinner from '../components/common/Spinner.jsx';
import './LiveScorePage.css';

const TABS = ['My Team', 'All Players', 'Leaderboard'];

export default function LiveScorePage() {
  const { matchId } = useParams();
  const navigate    = useNavigate();
  const socketRef   = useRef(null);

  const [match, setMatch]       = useState(null);
  const [scores, setScores]     = useState([]);
  const [myTeam, setMyTeam]     = useState(null);
  const [leaderboard, setBoard] = useState([]);
  const [tab, setTab]           = useState(0);
  const [loading, setLoading]   = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    loadData();
    setupSocket();
    return () => socketRef.current?.disconnect();
  }, [matchId]);

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
      } catch { /* no team */ }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function setupSocket() {
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.emit('joinMatch', matchId);

    socket.on('statsUpdate', async () => {
      // Refresh scores silently
      try {
        const [sRes, lRes] = await Promise.all([
          api.get(`/matches/${matchId}/scores`),
          api.get(`/matches/${matchId}/leaderboard`),
        ]);
        setScores(sRes.data.scores || []);
        setBoard(lRes.data.leaderboard || []);
        setLastUpdate(new Date());
        if (myTeam) {
          const tRes = await api.get(`/teams/match/${matchId}`);
          setMyTeam(tRes.data.team);
        }
      } catch { /* silent */ }
    });

    socket.on('matchCompleted', () => {
      setTimeout(() => navigate(`/match/${matchId}/result`), 2000);
    });

    socket.on('swapsProcessed', async () => {
      try {
        const tRes = await api.get(`/teams/match/${matchId}`);
        setMyTeam(tRes.data.team);
      } catch { /* silent */ }
    });
  }

  const scoreMap = Object.fromEntries(scores.map(s => [s.player_id, s]));

  if (loading) return <Spinner center />;

  return (
    <div className="page live-page">
      {/* Header */}
      <div className="live-header">
        <button className="btn-back" onClick={() => navigate('/')}>‹</button>
        <div className="live-header-center">
          <div className="flex items-center gap-2">
            {match?.status === 'live' && <span className="status-dot status-live" />}
            <span className="live-header-title">
              {match?.team_a} vs {match?.team_b}
            </span>
          </div>
          {lastUpdate && (
            <span className="live-updated text-muted text-sm">
              Updated {lastUpdate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {(match?.status === 'live' || match?.status === 'completed') && (
            <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/match/${matchId}/compare`)}>
              ⚔ Compare
            </button>
          )}
          {match?.status === 'completed' && (
            <button className="btn btn-sm btn-secondary" onClick={() => navigate(`/match/${matchId}/result`)}>
              Result
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="container mt-4">
        <div className="tabs">
          {TABS.map((t, i) => (
            <button key={t} className={`tab ${tab === i ? 'active' : ''}`} onClick={() => setTab(i)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* ── TAB 0: My Team ── */}
      {tab === 0 && (
        <div className="container mt-4">
          {!myTeam ? (
            <div className="live-no-team card text-center">
              <p className="text-secondary">You didn't submit a team for this match.</p>
            </div>
          ) : (
            <>
              <div className="my-team-summary card mb-4">
                <div className="my-team-total">
                  <span className="total-pts">{myTeam.total_fantasy_points || 0}</span>
                  <span className="total-label text-muted text-sm">Total Points</span>
                </div>
                {myTeam.match_rank && (
                  <div className="my-team-rank">
                    <span className="rank-num">#{myTeam.match_rank}</span>
                    <span className="text-muted text-sm">Rank</span>
                  </div>
                )}
              </div>

              {/* Swap notifications */}
              {myTeam.swaps?.length > 0 && (
                <div className="swap-notice mb-4">
                  <span className="swap-icon">🔄</span>
                  <div>
                    <p className="swap-title">Auto-swap applied</p>
                    {myTeam.swaps.map((s, i) => (
                      <p key={i} className="text-sm text-secondary">
                        {s.swapped_out_name} → {s.swapped_in_name}
                        {s.inherited_role && ` (${s.inherited_role === 'captain' ? 'C 2×' : 'VC 1.5×'} transferred)`}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              <div className="player-score-list">
                {myTeam.players.filter(p => !p.is_backup).map(p => {
                  const stats = scoreMap[p.id];
                  const effectiveCap = myTeam.resolved_captain_id || myTeam.captain_id;
                  const effectiveVc  = myTeam.resolved_vice_captain_id || myTeam.vice_captain_id;
                  const role = p.id === effectiveCap ? 'captain' : p.id === effectiveVc ? 'vc' : null;
                  const multiplier = role === 'captain' ? 2 : role === 'vc' ? 1.5 : 1;
                  const pts = stats ? Math.round((stats.fantasy_points || 0) * multiplier) : 0;

                  return (
                    <PlayerScoreRow
                      key={p.id}
                      player={p}
                      stats={stats}
                      pts={pts}
                      role={role}
                    />
                  );
                })}

                {/* Backups */}
                {myTeam.players.filter(p => p.is_backup).length > 0 && (
                  <>
                    <p className="backup-label text-muted text-sm mt-4 mb-2">BACKUPS</p>
                    {myTeam.players.filter(p => p.is_backup).map(p => {
                      const stats = scoreMap[p.id];
                      return (
                        <PlayerScoreRow
                          key={p.id}
                          player={p}
                          stats={stats}
                          pts={stats?.fantasy_points || 0}
                          role={null}
                          isBackup
                        />
                      );
                    })}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── TAB 1: All Players ── */}
      {tab === 1 && (
        <div className="container mt-4 player-score-list">
          {scores.length === 0 ? (
            <div className="card text-center text-secondary">No scores yet</div>
          ) : (
            scores.map((s, i) => (
              <div key={s.player_id} className="score-row card mb-2">
                <span className="score-rank text-muted mono">#{i + 1}</span>
                <div className="score-info">
                  <span className="player-name">{s.name}</span>
                  <span className="text-muted text-sm">{s.team}</span>
                </div>
                <div className="score-stats text-sm text-secondary mono">
                  {s.runs > 0 && <span>{s.runs}r</span>}
                  {s.wickets > 0 && <span>{s.wickets}w</span>}
                  {s.catches > 0 && <span>{s.catches}c</span>}
                </div>
                <span className="score-pts text-cyan mono">{s.fantasy_points}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── TAB 2: Leaderboard ── */}
      {tab === 2 && (
        <div className="container mt-4">
          {leaderboard.map((entry, i) => (
            <div
              key={entry.user_id}
              className={`lb-row card mb-2 lb-row-clickable ${entry.user_id ? 'lb-me' : ''}`}
              onClick={() => navigate(`/match/${matchId}/live?viewUser=${entry.user_id}`)}
            >
              <span className="lb-rank mono">
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
              </span>
              <div className="lb-info">
                <span className="player-name">{entry.name}</span>
              </div>
              <span className="lb-pts text-cyan mono font-bold">
                {entry.total_fantasy_points}
              </span>
              <span className="lb-chevron">›</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerScoreRow({ player, stats, pts, role, isBackup }) {
  return (
    <div className={`player-score-row ${isBackup ? 'backup-row' : ''} ${!stats?.is_playing_xi ? 'not-playing' : ''}`}>
      <div className="psr-left">
        {role === 'captain' && <span className="role-badge captain-badge">C</span>}
        {role === 'vc'      && <span className="role-badge vc-badge">VC</span>}
        {!role              && <span className="role-badge empty-badge" />}
        <div>
          <span className="player-name">{player.name}</span>
          <span className="text-muted text-sm"> {player.team}</span>
          {!stats?.is_playing_xi && <span className="not-playing-label"> · Not playing</span>}
        </div>
      </div>
      <div className="psr-right">
        {stats && (
          <div className="stat-chips">
            {stats.runs  > 0 && <span className="chip">{stats.runs}r</span>}
            {stats.wickets > 0 && <span className="chip">{stats.wickets}w</span>}
            {stats.catches > 0 && <span className="chip">{stats.catches}c</span>}
          </div>
        )}
        <span className={`psr-pts mono ${pts > 0 ? 'text-cyan' : 'text-muted'}`}>{pts}</span>
        {role && <span className="multiplier-label text-muted text-sm">×{role === 'captain' ? 2 : 1.5}</span>}
      </div>
    </div>
  );
}
