import { useState, useEffect, useRef } from 'react';

import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api, { SOCKET_URL } from '../utils/api.js';
import Spinner from '../components/common/Spinner.jsx';
import './LiveScorePage.css';

const BASE_TABS = ['Leaderboard', 'Match Score', 'Compare', 'All Players'];

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
  const [tab, setTab]           = useState(0); // will update after match loads
  const [viewTeam, setViewTeam] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [result, setResult]       = useState(null);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [compareA, setCompareA] = useState(0);
  const [compareB, setCompareB] = useState(0);
  const [inlineCompare, setInlineCompare] = useState(null);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [compareAutoLoaded, setCompareAutoLoaded] = useState(false);
  const TABS = match?.status === 'completed'
    ? ['Result', ...BASE_TABS]
    : BASE_TABS;

  const [injection, setInjection] = useState(null);

  useEffect(() => {
    loadData();
    setupSocket();
    return () => socketRef.current?.disconnect();
  }, [matchId]);

  async function loadUserTeam(userId, userName, totalPts) {
    setLoadingTeam(true);
    try {
      const res = await api.get(`/teams/user/${userId}/match/${matchId}`);
      const team = res.data.team;
      setViewTeam({ 
        name: userName, 
        players: team.players, 
        swaps: team.swaps || [],
        total: totalPts 
      });
    } catch {}
    finally { setLoadingTeam(false); }
  }

  async function loadData() {
    try {
      const [sRes, lRes] = await Promise.all([
        api.get(`/matches/${matchId}/scores`),
        api.get(`/matches/${matchId}/leaderboard`),
      ]);
      const m = sRes.data.match;
      setMatch(m);
      // compareA/B also set when board loads below
      if (m?.status === 'completed') setTab(0); // default to Result tab for completed
      setScores(sRes.data.scores || []);
      const lb = lRes.data.leaderboard || [];
      setBoard(lb);
      // Auto-set compare to rank #1 and #2 and load inline compare
      if (lb.length >= 2) {
        const aId = lb[0].user_id;
        const bId = lb[1].user_id;
        setCompareA(prev => prev || aId);
        setCompareB(prev => prev || bId);
      }
      try {
        const snRes = await api.get(`/matches/${matchId}/rank-snapshots`);
        setSnapshots(snRes.data.series || []);
      } catch {}
      // Fetch result for completed matches
      try {
        const m = sRes.data.match;
        if (m?.status === 'completed') {
          const rRes = await api.get(`/leaderboard/match/${matchId}/result`);
          setResult(rRes.data);
        }
      } catch {}
      setLastUpdate(new Date());
      try {
        const tRes = await api.get(`/teams/match/${matchId}`);
        setMyTeam(tRes.data.team);
      } catch {}
    } catch {}
    finally { setLoading(false); }
  }

  useEffect(() => {
    const compareTab = match?.status === 'completed' ? 3 : 2;
    if (tab === compareTab && compareA && compareB && compareA !== compareB) {
      loadInlineCompare(compareA, compareB);
    }
  }, [tab, compareA, compareB]);

  async function loadInlineCompare(userA, userB) {
    if (!userA || !userB || userA === userB) return;
    setLoadingCompare(true);
    try {
      const res = await api.get(`/teams/compare/${matchId}?userA=${userA}&userB=${userB}`);
      setInlineCompare(res.data);
    } catch {}
    finally { setLoadingCompare(false); }
  }

  function setupSocket() {
    try {
      const socket = io(SOCKET_URL, { transports: ['websocket'] });
      socketRef.current = socket;
      socket.on('connect', () => {
        socket.emit('joinMatch', matchId);
        console.log('[socket] joined match', matchId);
      });
      socket.on('injection', (data) => {
        setInjection(data);
        setTimeout(() => setInjection(null), 5000);
      });
      socket.on('statsUpdate', async () => {
        try {
          const [mRes, sRes, lRes] = await Promise.all([
            api.get(`/matches/${matchId}`),
            api.get(`/matches/${matchId}/scores`),
            api.get(`/matches/${matchId}/leaderboard`),
          ]);
          setMatch(mRes.data.match);
          setScores(sRes.data.scores || []);
          const lb = lRes.data.leaderboard || [];
      setBoard(lb);
      // Auto-set compare to rank #1 and #2 and load inline compare
      if (lb.length >= 2) {
        const aId = lb[0].user_id;
        const bId = lb[1].user_id;
        setCompareA(prev => prev || aId);
        setCompareB(prev => prev || bId);
      }
          setLastUpdate(new Date());
        } catch {}
      });
    } catch {}
  }

  if (loading) return <Spinner center />;

  const scoreMap = {};
  scores.forEach(s => { scoreMap[s.player_id] = s; });

  // Compute live prize preview
  function computePrizes(lb) {
    const n = lb.length;
    if (n < 2) return [];
    const entryUnits = lb[0]?.entry_units || 300;
    const totalPool  = n * entryUnits;
    const pcts       = n >= 5 ? [0.50, 0.30, 0.20] : [0.60, 0.40];
    const numWinners = pcts.length;
    const grossByPos = pcts.map(p => Math.floor(totalPool * p));
    grossByPos[0]   += totalPool - grossByPos.reduce((a,b)=>a+b,0);

    return lb.map((entry, i) => {
      const pos    = i + 1;
      const gross  = pos <= numWinners ? grossByPos[pos-1] : 0;
      const net    = gross - entryUnits;
      return { ...entry, gross, net, isWinner: pos <= numWinners };
    });
  }
  const prizeData  = computePrizes(leaderboard);
  const entryUnits = leaderboard[0]?.entry_units || 300;
  const totalPool  = leaderboard.length * entryUnits;
  const numWinners = leaderboard.length >= 5 ? 3 : leaderboard.length >= 2 ? 2 : 0;

  // Build innings data from scores — normalise team names to match match.team_a/team_b
  const normaliseTeam = (name) => (name || '').toLowerCase().trim();
  const teamANorm = normaliseTeam(match?.team_a);
  const teamBNorm = normaliseTeam(match?.team_b);
  const resolveTeam = (rawTeam) => {
    const n = normaliseTeam(rawTeam);
    if (n === teamANorm || teamANorm.includes(n) || n.includes(teamANorm)) return match?.team_a;
    if (n === teamBNorm || teamBNorm.includes(n) || n.includes(teamBNorm)) return match?.team_b;
    return rawTeam; // fallback to raw
  };

  const innings = {};
  scores.forEach(s => {
    const team = resolveTeam(s.team);
    if (!innings[team]) innings[team] = { runs: 0, wickets: 0, batters: [], bowlers: [] };
    const t = innings[team];
    if ((s.runs > 0 || s.balls_faced > 0) && s.dismissal_type !== 'dnb') {
      t.runs += s.runs || 0;
      if (s.dismissal_type && !['notout','dnb',''].includes(s.dismissal_type)) t.wickets++;
      t.batters.push(s);
    }
    if (s.overs_bowled > 0) {
      // Bowler belongs to OPPOSITE team from batters
      const bowlerTeam = resolveTeam(s.team);
      if (!innings[bowlerTeam]) innings[bowlerTeam] = { runs: 0, wickets: 0, batters: [], bowlers: [] };
      innings[bowlerTeam].bowlers.push(s);
    }
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
              {(() => {
                const swappedInIds = new Set((viewTeam.swaps||[]).map(s => s.swapped_in_player_id));
                const swappedOutIds = new Set((viewTeam.swaps||[]).map(s => s.swapped_out_player_id));
                const mainPlayers = viewTeam.players.filter(p => !p.is_backup);
                const backupPlayers = viewTeam.players.filter(p => p.is_backup);
                
                return <>
                  {mainPlayers.map(p => (
                    <PlayerRow key={p.id} player={p} pts={p.fantasy_points} 
                      role={p.role_in_team} isBackup={false} 
                      isPlaying={p.is_playing_xi}
                      swappedOut={swappedOutIds.has(p.id)} />
                  ))}
                  {backupPlayers.map(p => (
                    <PlayerRow key={p.id} player={p} pts={p.fantasy_points}
                      role={swappedInIds.has(p.id) ? p.role_in_team : null}
                      isBackup={!swappedInIds.has(p.id)}
                      swappedIn={swappedInIds.has(p.id)}
                      isPlaying={p.is_playing_xi} />
                  ))}
                </>;
              })()}
            </>
        }
      </div>
    </div>
  );

  return (
    <div className="ls-page">
      {/* 💉 Injection toast */}
      {injection && (
        <div style={{position:'fixed',top:12,left:'50%',transform:'translateX(-50%)',zIndex:100,
          background:'#1e1e2e',border:'1px solid rgba(248,113,113,0.4)',borderRadius:12,
          padding:'10px 16px',display:'flex',alignItems:'center',gap:8,
          boxShadow:'0 4px 20px rgba(0,0,0,0.4)',maxWidth:300,width:'90%'}}>
          <span style={{fontSize:'1.2rem'}}>💉</span>
          <div>
            <div style={{fontSize:'0.8rem',fontWeight:600,color:'#f87171'}}>{injection.userName} got injected!</div>
            <div style={{fontSize:'0.7rem',color:'var(--text-muted)'}}>Dropped from #{injection.fromRank} → #{injection.toRank}</div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="ls-header">
        <button className="ls-back" onClick={() => navigate('/')}>‹</button>
        <div className="ls-header-info">
          <span className="ls-header-title">{match?.team_a} vs {match?.team_b}</span>
          {match?.toss_info && (
            <span style={{fontSize:'0.65rem',color:'var(--text-muted)',marginTop:1}}>{match.toss_info}</span>
          )}
          <span className="ls-header-sub">
            {match?.status === 'live' && <span className="ls-live-dot">● </span>}
            {match?.status === 'live' ? 'Live' : match?.status}
            {lastUpdate && ` · ${lastUpdate.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}`}
          </span>
        </div>
        <div className="ls-header-actions">

        </div>
      </div>

      {/* Tabs */}
      <div className="ls-tabs">
        {TABS.map((t, i) => (
          <button key={t} className={`ls-tab ${tab === i ? 'active' : ''}`} onClick={() => setTab(i)}>{t}</button>
        ))}
      </div>

      {/* Tab 0: Result (completed only) */}
      {tab === 0 && match?.status === 'completed' && result && (
        <ResultTab result={result} currentUserId={null} />
      )}

      {/* Tab 0/1: Leaderboard */}
      {((match?.status === 'completed' && tab === 1) || (match?.status !== 'completed' && tab === 0)) && (
        <div className="ls-content">
          {/* Match score summary — parse JSON live_score for accuracy */}
          {match?.live_score && (() => {
            let innings = [];
            try { innings = JSON.parse(match.live_score); } catch {
              // Legacy string format fallback
              innings = (match.live_score.split(' | ')).map(part => {
                const m2 = part.match(/^(.+?)\s+(\d+)\/(\d+)\s+\(([^)]+)\)$/);
                return m2 ? { teamName: m2[1], r: m2[2], w: m2[3], o: m2[4] } : null;
              }).filter(Boolean);
            }
            if (!innings.length) return null;
            return (
              <div className="ls-match-summary">
                {innings.map((s, i) => (
                  <div key={i} className="ls-summary-team">
                    <span className="ls-summary-name">{(s.teamName||'').toUpperCase()}</span>
                    <span className="ls-summary-score">{s.r}/{s.w} <span style={{fontSize:'0.75rem',color:'var(--color-text-secondary)'}}>({s.o} ov)</span></span>
                  </div>
                ))}
              </div>
            );
          })()}
          {/* Rank trajectory chart — foldable */}
          {snapshots.length > 0 && (
            <Foldable title="Points during match" defaultOpen={false}>
              <PointsChart series={snapshots} />
            </Foldable>
          )}

          {/* Prize pool card — foldable */}
          {leaderboard.length >= 2 && (
            <Foldable title={`Prize Pool · ${totalPool}u · ${leaderboard.length} players`} defaultOpen={false}>
              <div style={{padding:'0 0 4px'}}>
                {prizeData.filter(e => e.isWinner).map((e, i) => (
                  <div key={e.user_id} className="ls-prize-row ls-prize-winner">
                    <span className="ls-prize-pos">{i===0?'🥇':i===1?'🥈':'🥉'}</span>
                    <span className="ls-prize-name">{e.name}</span>
                    <span className="ls-prize-share">{i===0?'50':i===1?'30':'20'}% · {e.gross}u</span>
                    <span className="ls-prize-net ls-net-win">+{e.net}</span>
                  </div>
                ))}
                <div className="ls-prize-row ls-prize-loser">
                  <span className="ls-prize-pos" style={{fontSize:'0.7rem'}}>#{numWinners+1}–{leaderboard.length}</span>
                  <span className="ls-prize-name" style={{color:'var(--color-text-secondary)',fontSize:'0.8rem'}}>
                    {prizeData.filter(e => !e.isWinner).map(e => e.name.split(' ')[0]).join(', ')}
                  </span>
                  <span className="ls-prize-share"></span>
                  <span className="ls-prize-net ls-net-loss">−{entryUnits}</span>
                </div>
              </div>
            </Foldable>
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

      {/* Tab 1/2: Match Score — innings grouped */}
      {((match?.status === 'completed' && tab === 2) || (match?.status !== 'completed' && tab === 1)) && (
        <div className="ls-content">
          {scores.length === 0
            ? <div className="ls-empty">Scores not available yet</div>
            : (() => {
                try {
                let liveScoreData = [];
                try { liveScoreData = JSON.parse(match?.live_score || '[]'); } catch {}

                // Use player team name to identify batting team per innings
                // SA batters in S1 all have team='South Africa', NZ bowlers in S1 have team='New Zealand'
                const s1BatTeamName = scores.find(s => s.scoreboard === 'S1' && s.balls_faced > 0)?.team || '';
                const s2BatTeamName = scores.find(s => s.scoreboard === 'S2' && s.balls_faced > 0)?.team || '';

                const inningsList = [
                  { sb: 'S1', num: 1, batTeam: s1BatTeamName },
                  { sb: 'S2', num: 2, batTeam: s2BatTeamName },
                ].filter(inn => inn.batTeam);

                if (inningsList.length === 0) {
                  return <div className="ls-empty">Score data syncing — check back shortly</div>;
                }

                return inningsList.map(inn => {
                  const batters = scores
                    .filter(s => s.scoreboard === inn.sb && s.team === inn.batTeam && s.balls_faced > 0)
                    .sort((a,b) => (a.sort_order||99) - (b.sort_order||99));

                  const bowlers = scores
                    .filter(s => s.scoreboard === inn.sb && s.overs_bowled > 0 && s.team !== inn.batTeam)
                    .sort((a,b) => (b.wickets||0) - (a.wickets||0));

                  const bowlingTeamName = bowlers[0]?.team || '';
                  const inningScore = liveScoreData.find(s => s.inning === inn.num);
                  const scoreText = inningScore ? `${inningScore.r}/${inningScore.w} (${inningScore.o} ov)` : '';

                  function isOut(p) {
                    return p.dismissal_type && !['notout','dnb',''].includes(p.dismissal_type);
                  }

                  return (
                    <div key={inn.sb} style={{marginBottom:24}}>
                      <div className="ls-innings-header">
                        <div>
                          <span style={{fontSize:'0.7rem',color:'var(--color-text-secondary)',display:'block',marginBottom:2}}>
                            {inn.num}{inn.num===1?'st':inn.num===2?'nd':'rd'} INNINGS
                          </span>
                          <span className="ls-innings-team">{inn.batTeam}</span>
                        </div>
                        <span className="ls-innings-score">{scoreText}</span>
                      </div>

                      {batters.length > 0 && (<>
                        <div className="ls-sc-section">Batting</div>
                        <table className="ls-sc-table">
                          <thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th></tr></thead>
                          <tbody>
                            {batters.map(p => (
                              <tr key={p.player_id} style={{opacity: isOut(p) ? 0.55 : 1}}>
                                <td>{p.is_active ? <strong>{p.name} *</strong> : p.name}</td>
                                <td className={p.runs>=50?'ls-highlight':''}>{p.runs||0}</td>
                                <td style={{color:'var(--color-text-secondary)'}}>{p.balls_faced||0}</td>
                                <td>{p.fours||0}</td>
                                <td>{p.sixes||0}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>)}

                      {bowlers.length > 0 && (<>
                        <div className="ls-sc-section" style={{marginTop:12}}>{bowlingTeamName} Bowling</div>
                        <table className="ls-sc-table">
                          <thead><tr><th>Bowler</th><th>O</th><th>W</th><th>R</th><th>Eco</th></tr></thead>
                          <tbody>
                            {bowlers.map(p => (
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
                      </>)}
                    </div>
                  );
                });
                } catch(e) {
                  return <div className="ls-empty" style={{color:'#f87171'}}>Error loading scorecard: {e.message}</div>;
                }
              })()
          }
        </div>
      )}

      {/* Tab 2/3: Compare */}
      {((match?.status === 'completed' && tab === 3) || (match?.status !== 'completed' && tab === 2)) && (
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

      {/* Tab 3/4: All Players */}
      {((match?.status === 'completed' && tab === 4) || (match?.status !== 'completed' && tab === 3)) && (
        <div className="ls-content">
          {scores.length === 0
            ? <div className="ls-empty">No player scores yet</div>
            : [...scores].sort((a,b) => (b.fantasy_points||0) - (a.fantasy_points||0)).map(p => (
                <div key={p.player_id} style={{
                  padding:'10px 14px',
                  borderBottom:'0.5px solid var(--border)'
                }}>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:5}}>
                        {p.is_playing_xi ? <span style={{width:6,height:6,borderRadius:'50%',background:'#00E5FF',flexShrink:0}} /> : null}
                        <span style={{fontSize:'0.875rem',fontWeight:500}}>{p.name}</span>
                      </div>
                      <div style={{fontSize:'0.7rem',color:'var(--text-muted)',marginTop:2}}>
                        {p.team?.split(' ').slice(0,2).join(' ')} · {p.role?.slice(0,3)}
                        {' · '}
                        {[
                          p.runs > 0 && `${p.runs}r`,
                          p.wickets > 0 && `${p.wickets}w`,
                          p.catches > 0 && `${p.catches}ct`,
                          p.stumpings > 0 && `${p.stumpings}st`,
                          p.overs_bowled > 0 && !p.wickets && `${p.overs_bowled}ov`,
                        ].filter(Boolean).join(' · ') || (p.is_playing_xi ? 'XI' : 'DNB')}
                      </div>
                      <BreakdownRow breakdown={p.breakdown} />
                    </div>
                    <span style={{
                      fontFamily:'var(--font-mono)',fontSize:'0.9rem',fontWeight:700,
                      color: p.fantasy_points > 0 ? 'var(--accent-primary)' : 'var(--text-muted)',
                      flexShrink:0
                    }}>{p.fantasy_points || 0}</span>
                  </div>
                </div>
              ))
          }
        </div>
      )}

    </div>
  );
}

function ResultTab({ result }) {
  const { rankings, prizePool, topPerformers } = result;
  const top3 = rankings.slice(0, 3);
  const basementCutoff = Math.ceil(rankings.length / 2);
  const basement = rankings.slice(basementCutoff);
  const entryFee = prizePool?.entry_units || 300;

  return (
    <div className="ls-content">
      {/* Podium */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:14}}>
        {[top3[1], top3[0], top3[2]].filter(Boolean).map((e, vi) => {
          const podPos = vi===0?2:vi===1?1:3;
          const medal = podPos===1?'🥇':podPos===2?'🥈':'🥉';
          const gross = e.gross_units||0;
          const net = e.net_units ?? (gross - entryFee);
          return (
            <div key={e.user_id} style={{
              background:'var(--bg-surface)',border:'1px solid var(--border)',
              borderRadius:10,padding:'10px 8px',textAlign:'center',
              ...(podPos===1?{borderColor:'rgba(186,117,23,0.4)',background:'rgba(186,117,23,0.05)'}:{})
            }}>
              <div style={{fontSize:'1.3rem'}}>{medal}</div>
              <div style={{fontSize:'0.75rem',fontWeight:600,marginTop:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.name}</div>
              <div style={{fontSize:'0.9rem',fontWeight:700,fontFamily:'var(--font-mono)',color:'var(--accent-primary)',marginTop:2}}>{e.total_fantasy_points}</div>
              {gross > 0 && <div style={{fontSize:'0.68rem',color:'var(--accent-green)',marginTop:2}}>+{net}u</div>}
            </div>
          );
        })}
      </div>

      {/* Full rankings */}
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:10,marginBottom:12,overflow:'hidden'}}>
        {rankings.map((e, i) => {
          const gross = e.gross_units||0;
          const net = e.net_units ?? (gross - entryFee);
          const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`;
          return (
            <div key={e.user_id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderBottom:i<rankings.length-1?'0.5px solid var(--border)':'none'}}>
              <span style={{width:28,textAlign:'center',fontSize:'0.8rem',flexShrink:0}}>{medal}</span>
              <span style={{flex:1,fontSize:'0.875rem',fontWeight:500}}>{e.name}</span>
              <span style={{fontFamily:'var(--font-mono)',fontSize:'0.875rem',color:'var(--accent-primary)',flexShrink:0}}>{e.total_fantasy_points}</span>
              <span style={{fontFamily:'var(--font-mono)',fontSize:'0.78rem',minWidth:52,textAlign:'right',color:net>=0?'var(--accent-green)':'#f87171',flexShrink:0}}>
                {net>=0?'+':''}{net}u
              </span>
            </div>
          );
        })}
      </div>

      {/* Basement */}
      {basement.length > 0 && (
        <div style={{background:'rgba(248,113,113,0.05)',border:'1px solid rgba(248,113,113,0.2)',borderRadius:10,padding:'10px 14px',marginBottom:12}}>
          <div style={{fontSize:'0.72rem',fontWeight:600,color:'#f87171',marginBottom:8}}>🪣 Basement</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {basement.map(e => (
              <div key={e.user_id} style={{background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:8,padding:'4px 10px',fontSize:'0.78rem',fontWeight:500}}>
                {e.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top performers */}
      {topPerformers?.length > 0 && (
        <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:10,overflow:'hidden'}}>
          <div style={{padding:'8px 14px',borderBottom:'1px solid var(--border)',fontSize:'0.72rem',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',color:'var(--text-muted)'}}>Top performers</div>
          {topPerformers.map((p, i) => (
            <div key={p.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 14px',borderBottom:i<topPerformers.length-1?'0.5px solid var(--border)':'none'}}>
              <span style={{fontSize:'0.72rem',color:'var(--text-muted)',width:16}}>#{i+1}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:'0.8rem',fontWeight:500}}>{p.name}</div>
                <div style={{fontSize:'0.68rem',color:'var(--text-muted)'}}>{p.team}</div>
              </div>
              <div style={{display:'flex',gap:4,flexShrink:0}}>
                {p.runs>0&&<span style={{fontSize:'0.68rem',background:'var(--bg-elevated)',padding:'2px 6px',borderRadius:4}}>{p.runs}r</span>}
                {p.wickets>0&&<span style={{fontSize:'0.68rem',background:'var(--bg-elevated)',padding:'2px 6px',borderRadius:4}}>{p.wickets}w</span>}
              </div>
              <span style={{fontFamily:'var(--font-mono)',fontSize:'0.875rem',color:'var(--accent-primary)',flexShrink:0}}>{p.fantasy_points}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BreakdownRow({ breakdown, multiplier = 1 }) {
  if (!breakdown || breakdown.notPlaying) return null;
  const items = [
    breakdown.playingXiBonus   && `XI +${breakdown.playingXiBonus}`,
    breakdown.runs             && `${breakdown.runs/1}r +${breakdown.runs}`,
    breakdown.boundaryBonus    && `4s +${breakdown.boundaryBonus}`,
    breakdown.sixBonus         && `6s +${breakdown.sixBonus}`,
    breakdown.halfCenturyBonus && `50 +${breakdown.halfCenturyBonus}`,
    breakdown.centuryBonus     && `100 +${breakdown.centuryBonus}`,
    breakdown.duckPenalty      && `duck ${breakdown.duckPenalty}`,
    breakdown.strikeRatePoints && `SR ${breakdown.strikeRatePoints > 0 ? '+' : ''}${breakdown.strikeRatePoints}`,
    breakdown.wicketPoints     && `${breakdown.wicketPoints/25}w +${breakdown.wicketPoints}`,
    breakdown.wicketHaulBonus  && `haul +${breakdown.wicketHaulBonus}`,
    breakdown.maidenPoints     && `maiden +${breakdown.maidenPoints}`,
    breakdown.bowlerDismissalBonus && `lbw/b +${breakdown.bowlerDismissalBonus}`,
    breakdown.economyPoints    && `eco ${breakdown.economyPoints > 0 ? '+' : ''}${breakdown.economyPoints}`,
    breakdown.catchPoints      && `ct +${breakdown.catchPoints}`,
    breakdown.stumpingPoints   && `st +${breakdown.stumpingPoints}`,
    breakdown.runOutPoints     && `ro +${breakdown.runOutPoints}`,
  ].filter(Boolean);
  if (items.length === 0) return null;
  const multLabel = multiplier === 2 ? ' × 2C' : multiplier === 1.5 ? ' × 1.5VC' : '';
  return (
    <div style={{fontSize:'0.68rem',color:'rgba(255,255,255,0.35)',marginTop:3,lineHeight:1.4}}>
      {items.join(' · ')}{multLabel}
    </div>
  );
}

function Foldable({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:10,marginBottom:12,overflow:'hidden'}}>
      <div onClick={() => setOpen(o => !o)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px',cursor:'pointer',userSelect:'none'}}>
        <span style={{fontSize:'0.72rem',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',color:'var(--text-muted)'}}>{title}</span>
        <span style={{color:'var(--text-muted)',fontSize:'0.8rem',transform:open?'rotate(180deg)':'none',transition:'transform 0.2s'}}>▾</span>
      </div>
      <div style={{borderTop: open ? '0.5px solid var(--border)' : 'none', display: open ? 'block' : 'none'}}>
        {children}
      </div>
    </div>
  );
}

function InlineCompare({ data }) {
  const A = data.teamA;
  const B = data.teamB;
  const commonIds = new Set(data.common.playerIds);
  const gap = A.total_fantasy_points - B.total_fantasy_points;

  const commonA = A.players.filter(p => commonIds.has(p.id));
  const uniqueA = A.players.filter(p => !commonIds.has(p.id));
  const uniqueB = B.players.filter(p => !commonIds.has(p.id));

  function MiniCell({ player, right }) {
    if (!player) return <div style={{flex:1}} />;
    const isCap = player.role_in_team === 'captain';
    const isVC  = player.role_in_team === 'vice_captain';
    const pts   = player.effective_pts || 0;
    const isXI  = player.is_playing_xi === 1;
    return (
      <div style={{flex:1,display:'flex',alignItems:'center',gap:5,justifyContent:right?'flex-end':'flex-start',minWidth:0}}>
        {!right && (isCap ? <span style={{fontSize:'0.6rem',fontWeight:700,padding:'1px 4px',borderRadius:3,background:'rgba(186,117,23,0.2)',color:'#cc8800'}}>C</span>
          : isVC ? <span style={{fontSize:'0.6rem',fontWeight:700,padding:'1px 4px',borderRadius:3,background:'rgba(0,188,212,0.2)',color:'#00bcd4'}}>V</span> : null)}
        {!right && isXI && <span style={{width:5,height:5,borderRadius:'50%',background:'#00E5FF',flexShrink:0}} />}
        <span style={{fontSize:'0.78rem',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{player.name.split(' ').pop()}</span>
        {right && isXI && <span style={{width:5,height:5,borderRadius:'50%',background:'#00E5FF',flexShrink:0}} />}
        {right && (isCap ? <span style={{fontSize:'0.6rem',fontWeight:700,padding:'1px 4px',borderRadius:3,background:'rgba(186,117,23,0.2)',color:'#cc8800'}}>C</span>
          : isVC ? <span style={{fontSize:'0.6rem',fontWeight:700,padding:'1px 4px',borderRadius:3,background:'rgba(0,188,212,0.2)',color:'#00bcd4'}}>V</span> : null)}
        <span style={{fontFamily:'var(--font-mono)',fontSize:'0.8rem',fontWeight:700,color:pts>0?'var(--accent-primary)':'var(--text-muted)',flexShrink:0,minWidth:24,textAlign:'center'}}>{pts}</span>
      </div>
    );
  }

  return (
    <div style={{background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:10,overflow:'hidden'}}>
      {/* Score bar */}
      <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',gap:8,padding:'10px 14px',borderBottom:'0.5px solid var(--border)',background:'var(--bg-surface)'}}>
        <div>
          <div style={{fontSize:'0.7rem',color:'var(--text-muted)'}}>{A.user_name}</div>
          <div style={{fontSize:'1.3rem',fontWeight:700,color:'var(--accent-primary)'}}>{A.total_fantasy_points}</div>
        </div>
        <div style={{display:'flex',alignItems:'center'}}>
          <span style={{padding:'3px 8px',borderRadius:12,fontSize:'0.72rem',fontWeight:700,
            background:gap>0?'rgba(29,158,117,0.2)':gap<0?'rgba(248,113,113,0.2)':'rgba(128,128,128,0.2)',
            color:gap>0?'#1D9E75':gap<0?'#f87171':'var(--text-muted)'}}>
            {gap>0?'+':''}{gap} pts
          </span>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:'0.7rem',color:'var(--text-muted)'}}>{B.user_name}</div>
          <div style={{fontSize:'1.3rem',fontWeight:700,color:'var(--accent-primary)'}}>{B.total_fantasy_points}</div>
        </div>
      </div>

      {/* Common players */}
      <div style={{padding:'6px 0'}}>
        <div style={{fontSize:'0.65rem',color:'var(--text-muted)',padding:'4px 14px',fontWeight:600}}>
          🤝 {commonA.length} common · {data.common.ptsA} vs {data.common.ptsB}
        </div>
        {commonA.map((p, i) => {
          const pb = B.players.find(x => x.id === p.id);
          return (
            <div key={p.id} style={{display:'flex',gap:8,padding:'5px 14px',borderBottom:'0.5px solid var(--border)'}}>
              <MiniCell player={p} right={false} />
              <MiniCell player={pb} right={true} />
            </div>
          );
        })}
      </div>

      {/* Unique players */}
      {(uniqueA.length > 0 || uniqueB.length > 0) && (
        <div style={{padding:'6px 0',borderTop:'0.5px solid var(--border)'}}>
          <div style={{fontSize:'0.65rem',color:'var(--text-muted)',padding:'4px 14px',fontWeight:600}}>
            ⚡ {Math.max(uniqueA.length,uniqueB.length)} unique · {uniqueA.reduce((s,p)=>s+(p.effective_pts||0),0)} vs {uniqueB.reduce((s,p)=>s+(p.effective_pts||0),0)}
          </div>
          {Array.from({length:Math.max(uniqueA.length,uniqueB.length)}).map((_,i) => (
            <div key={i} style={{display:'flex',gap:8,padding:'5px 14px',borderBottom:'0.5px solid var(--border)'}}>
              <MiniCell player={uniqueA[i]} right={false} />
              <MiniCell player={uniqueB[i]} right={true} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PointsChart({ series }) {
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);
  const colors = ['#00e5ff','#a78bfa','#4ade80','#f472b6','#fb923c','#facc15','#60a5fa'];
  const maxOver = Math.max(...series.flatMap(s => s.data.map(d => d.over)));

  function interp(data, over) {
    for (let i = 0; i < data.length - 1; i++) {
      if (over >= data[i].over && over <= data[i+1].over) {
        const t = (over - data[i].over) / (data[i+1].over - data[i].over);
        return Math.round(data[i].pts + t * (data[i+1].pts - data[i].pts));
      }
    }
    if (over <= data[0].over) return data[0].pts;
    return data[data.length-1].pts;
  }

  const injections = [];
  series.forEach((s, si) => {
    for (let i = 1; i < s.data.length; i++) {
      if ((s.data[i].rank - s.data[i-1].rank) >= 2) {
        injections.push({ over: s.data[i].over, pts: s.data[i].pts, color: colors[si%colors.length] });
      }
    }
  });

  function buildChart() {
    const canvas = canvasRef.current;
    if (!canvas || !window.Chart) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    const labels = [];
    for (let o = 0; o <= maxOver; o++) labels.push(o);
    if (labels[labels.length-1] !== maxOver) labels.push(maxOver);

    const datasets = series.map((s, si) => ({
      label: s.name,
      data: labels.map(o => ({ x: o, y: interp(s.data, o) })),
      borderColor: colors[si % colors.length],
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.2,
    }));

    if (injections.length > 0) {
      datasets.push({
        label: '_inj',
        data: injections.map(inj => ({ x: inj.over, y: inj.pts })),
        borderColor: 'transparent',
        backgroundColor: '#f87171',
        pointRadius: 6,
        showLine: false,
        type: 'scatter',
      });
    }

    chartRef.current = new window.Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        parsing: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: i => i.dataset.label !== '_inj',
            callbacks: {
              title: ctx => `Over ${Math.round(ctx[0].parsed.x * 10)/10}`,
              label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}pts`,
            },
            backgroundColor: 'rgba(10,10,30,0.95)',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            titleColor: 'rgba(255,255,255,0.5)',
            bodyColor: '#fff',
            padding: 8,
          },
        },
        scales: {
          x: {
            type: 'linear', min: 0, max: maxOver,
            ticks: { stepSize: 5, color: 'rgba(255,255,255,0.25)', font: { size: 10 }, callback: v => v % 5 === 0 ? v : '' },
            grid: { color: 'rgba(255,255,255,0.04)' },
            border: { color: 'rgba(255,255,255,0.08)' },
          },
          y: {
            min: 0,
            ticks: { stepSize: 100, color: 'rgba(255,255,255,0.25)', font: { size: 10 } },
            grid: { color: 'rgba(255,255,255,0.04)' },
            border: { color: 'rgba(255,255,255,0.08)' },
          },
        },
      },
      plugins: [{
        id: 'inningsLine',
        afterDraw(chart) {
          if (maxOver <= 22) return;
          const { ctx, scales } = chart;
          const xp = scales.x.getPixelForValue(20);
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.15)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4,3]);
          ctx.beginPath(); ctx.moveTo(xp, scales.y.top); ctx.lineTo(xp, scales.y.bottom); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(255,255,255,0.2)';
          ctx.font = '9px sans-serif';
          ctx.fillText('innings', xp+3, scales.y.top + 10);
          ctx.restore();
        }
      }]
    });
  }

  useEffect(() => {
    if (window.Chart) {
      buildChart();
    } else {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
      script.onload = buildChart;
      document.head.appendChild(script);
    }
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [series]);

  return (
    <div style={{padding:'10px 12px'}}>
      <div style={{position:'relative',width:'100%',height:200}}>
        <canvas ref={canvasRef} />
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:6}}>
        {series.map((s,si) => (
          <div key={s.name} style={{display:'flex',alignItems:'center',gap:4,fontSize:'0.65rem',color:'rgba(255,255,255,0.4)'}}>
            <div style={{width:10,height:2,background:colors[si%colors.length],borderRadius:1}}/>
            {s.name}
          </div>
        ))}
        {injections.length > 0 && (
          <div style={{display:'flex',alignItems:'center',gap:4,fontSize:'0.65rem',color:'#f87171'}}>
            <div style={{width:7,height:7,borderRadius:'50%',background:'#f87171'}}/>
            injection
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerRow({ player, pts, role, isBackup, isPlaying, swappedIn, swappedOut }) {
  const multi = role === 'captain' ? 2 : role === 'vice_captain' ? 1.5 : 1;
  // pts is base_fantasy_points, apply multiplier
  const basePts = pts ?? player?.base_fantasy_points ?? player?.fantasy_points;
  const total = basePts !== undefined && basePts !== null ? Math.round(basePts * multi) : undefined;
  return (
    <div className={`ls-player-row ${isBackup ? 'ls-backup' : ''} ${isPlaying === false || swappedOut ? 'ls-not-playing' : ''}`}>
      <div className="ls-player-left">
        {role === 'captain'      && <span className="ls-badge ls-cap">C</span>}
        {role === 'vice_captain' && <span className="ls-badge ls-vc">V</span>}
        {swappedIn  && !role     && <span className="ls-badge" style={{background:'rgba(29,158,117,0.2)',color:'#1D9E75',fontSize:'0.6rem'}}>↑IN</span>}
        {swappedOut              && <span className="ls-badge" style={{background:'rgba(248,113,113,0.2)',color:'#f87171',fontSize:'0.6rem'}}>OUT</span>}
        {!role && !swappedIn && !swappedOut && <span className="ls-badge-empty" />}
        <div className="ls-player-info">
          <div style={{display:'flex',alignItems:'center',gap:5}}>
            {isPlaying === 1 || isPlaying === true ? 
              <span style={{width:6,height:6,borderRadius:'50%',background:'#00E5FF',flexShrink:0,display:'inline-block'}} title="Playing XI" /> 
              : null}
            <span className="ls-player-name" style={{opacity: swappedOut ? 0.4 : 1}}>{player.name}</span>
          </div>
          <span className="ls-player-team">
            {player.team}
            {swappedOut ? ' · swapped out' : ''}
            {swappedIn ? ' · swapped in' : ''}
          </span>
          <BreakdownRow breakdown={player.breakdown} multiplier={role==='captain'?2:role==='vice_captain'?1.5:1} />
        </div>
      </div>
      <span className={`ls-player-pts ${total > 0 ? 'ls-pts-active' : ''}`}>
        {total !== undefined ? total : '—'}
      </span>
    </div>
  );
}
