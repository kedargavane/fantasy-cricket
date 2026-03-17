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
      setViewTeam({ 
        name: userName, 
        players: res.data.team.players, 
        swaps: res.data.team.swaps || [],
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
      if (m?.status === 'completed') setTab(0); // default to Result tab for completed
      setScores(sRes.data.scores || []);
      setBoard(lRes.data.leaderboard || []);
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

  function setupSocket() {
    try {
      const socket = io(SOCKET_URL, { transports: ['websocket'] });
      socketRef.current = socket;
      socket.emit('joinMatch', matchId);
      socket.on('injection', (data) => {
        setInjection(data);
        setTimeout(() => setInjection(null), 5000);
      });
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
          {/* Rank trajectory chart */}
          {/* RankChart hidden until data is available */}

          {/* Prize pool card */}
          {leaderboard.length >= 2 && (
            <div className="ls-prize-card">
              <div className="ls-prize-header">
                <span className="ls-prize-title">Prize Pool</span>
                <span className="ls-prize-total">{totalPool} units · {leaderboard.length} players</span>
              </div>
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

      {/* Tab 1/2: Match Score */}
      {((match?.status === 'completed' && tab === 2) || (match?.status !== 'completed' && tab === 1)) && (
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

function RankChart({ series }) {
  const colors = ['#00e5ff','#a78bfa','#fb923c','#4ade80','#f472b6','#facc15','#60a5fa','#34d399','#f87171'];
  const allOvers = [...new Set(series.flatMap(s => s.data.map(d => d.over)))].sort((a,b)=>a-b);
  const maxRank = Math.max(...series.flatMap(s => s.data.map(d => d.rank)));
  const W = 340, H = 120, PL = 28, PR = 8, PT = 8, PB = 20;
  const cW = W - PL - PR, cH = H - PT - PB;
  const x = o => PL + (allOvers.length < 2 ? cW/2 : (allOvers.indexOf(o) / (allOvers.length-1)) * cW);
  const y = r => PT + ((r-1) / Math.max(maxRank-1,1)) * cH;

  return (
    <div style={{background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:10,padding:'10px 12px',marginBottom:12}}>
      <div style={{fontSize:'0.65rem',textTransform:'uppercase',letterSpacing:'0.05em',color:'var(--text-muted)',marginBottom:6}}>Rank during match</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',overflow:'visible'}}>
        {/* Y axis labels */}
        {Array.from({length:maxRank},(_,i)=>i+1).map(r=>(
          <text key={r} x={PL-4} y={y(r)+4} textAnchor="end" fontSize="9" fill="var(--text-muted)">#{r}</text>
        ))}
        {/* Grid lines */}
        {Array.from({length:maxRank},(_,i)=>i+1).map(r=>(
          <line key={r} x1={PL} y1={y(r)} x2={W-PR} y2={y(r)} stroke="var(--border)" strokeWidth="0.5"/>
        ))}
        {/* Lines per user */}
        {series.map((s,si) => {
          const pts = s.data.map(d => `${x(d.over)},${y(d.rank)}`).join(' ');
          return (
            <g key={s.name}>
              <polyline points={pts} fill="none" stroke={colors[si%colors.length]} strokeWidth="2" strokeLinejoin="round"/>
              {s.data.map((d,di) => (
                <circle key={di} cx={x(d.over)} cy={y(d.rank)} r="2.5" fill={colors[si%colors.length]}/>
              ))}
            </g>
          );
        })}
        {/* X axis labels - show every 5 overs */}
        {allOvers.filter(o => o % 5 === 0).map(o => (
          <text key={o} x={x(o)} y={H} textAnchor="middle" fontSize="9" fill="var(--text-muted)">{o}ov</text>
        ))}
      </svg>
      <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:6}}>
        {series.map((s,si) => (
          <div key={s.name} style={{display:'flex',alignItems:'center',gap:4,fontSize:'0.65rem',color:'var(--text-muted)'}}>
            <div style={{width:8,height:8,borderRadius:'50%',background:colors[si%colors.length],flexShrink:0}}/>
            {s.name}
          </div>
        ))}
      </div>
    </div>
  );
}

function PlayerRow({ player, pts, role, isBackup, isPlaying, swappedIn, swappedOut }) {
  const multi = role === 'captain' ? 2 : role === 'vice_captain' ? 1.5 : 1;
  const total = pts !== undefined ? Math.round(pts * multi) : undefined;
  return (
    <div className={`ls-player-row ${isBackup ? 'ls-backup' : ''} ${isPlaying === false || swappedOut ? 'ls-not-playing' : ''}`}>
      <div className="ls-player-left">
        {role === 'captain'      && <span className="ls-badge ls-cap">C</span>}
        {role === 'vice_captain' && <span className="ls-badge ls-vc">V</span>}
        {swappedIn  && !role     && <span className="ls-badge" style={{background:'rgba(29,158,117,0.2)',color:'#1D9E75',fontSize:'0.6rem'}}>↑IN</span>}
        {swappedOut              && <span className="ls-badge" style={{background:'rgba(248,113,113,0.2)',color:'#f87171',fontSize:'0.6rem'}}>OUT</span>}
        {!role && !swappedIn && !swappedOut && <span className="ls-badge-empty" />}
        <div className="ls-player-info">
          <span className="ls-player-name">{player.name}</span>
          <span className="ls-player-team">
            {player.team}
            {swappedOut ? ' · swapped out' : isPlaying === false ? ' · not playing' : ''}
            {swappedIn ? ' · swapped in' : ''}
          </span>
        </div>
      </div>
      <span className={`ls-player-pts ${total > 0 ? 'ls-pts-active' : ''}`}>
        {total !== undefined ? total : '—'}
      </span>
    </div>
  );
}
