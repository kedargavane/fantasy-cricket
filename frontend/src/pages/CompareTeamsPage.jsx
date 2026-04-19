import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../utils/api.js';
import Spinner from '../components/common/Spinner.jsx';
import './CompareTeamsPage.css';

export default function CompareTeamsPage() {
  const { matchId }  = useParams();
  const navigate     = useNavigate();
  const { user }     = useAuth();

  const [leaderboard, setLeaderboard] = useState([]);
  const [userA, setUserA]             = useState(null);
  const [userB, setUserB]             = useState(null);
  const [comparison, setComparison]   = useState(null);
  const [loading, setLoading]         = useState(false);
  const [lbLoading, setLbLoading]     = useState(true);

  useEffect(() => { loadLeaderboard(); }, [matchId]);
  useEffect(() => {
    if (userA && userB && userA !== userB) loadComparison();
    else setComparison(null);
  }, [userA, userB]);

  async function loadLeaderboard() {
    setLbLoading(true);
    try {
      const res = await api.get(`/matches/${matchId}/leaderboard`);
      const lb  = res.data.leaderboard || [];
      setLeaderboard(lb);
      const me    = lb.find(e => e.user_id === user.id);
      const top   = lb[0];
      const other = top?.user_id === user.id ? lb[1] : top;
      if (me)    setUserA(me.user_id);
      if (other) setUserB(other.user_id);
    } catch {}
    finally { setLbLoading(false); }
  }

  async function loadComparison() {
    setLoading(true); setComparison(null);
    try {
      const res = await api.get(`/teams/compare/${matchId}?userA=${userA}&userB=${userB}`);
      setComparison(res.data);
    } catch (err) {
      if (err.response?.status === 403) setComparison({ error: err.response.data.error });
    } finally { setLoading(false); }
  }

  if (lbLoading) return <Spinner center />;

  // Build rank label for selector
  const rankLabel = (uid) => {
    const e = leaderboard.find(x => x.user_id === uid);
    if (!e) return '';
    const idx = leaderboard.indexOf(e) + 1;
    return ` · #${idx}`;
  };

  return (
    <div className="cp-page">

      {/* Header */}
      <div className="cp-header">
        <button className="cp-back" onClick={() => navigate(`/match/${matchId}/live`)}>‹</button>
        <span className="cp-title">Compare Teams</span>
      </div>

      {/* Selectors */}
      <div className="cp-selectors">
        <select className="cp-sel" value={userA || ''} onChange={e => setUserA(parseInt(e.target.value))}>
          {leaderboard.filter(e => e.user_id !== userB).map(e => (
            <option key={e.user_id} value={e.user_id}>{e.name}{rankLabel(e.user_id)}</option>
          ))}
        </select>
        <span className="cp-vs">VS</span>
        <select className="cp-sel" value={userB || ''} onChange={e => setUserB(parseInt(e.target.value))}>
          {leaderboard.filter(e => e.user_id !== userA).map(e => (
            <option key={e.user_id} value={e.user_id}>{e.name}{rankLabel(e.user_id)}</option>
          ))}
        </select>
      </div>

      {loading && <Spinner center />}

      {comparison?.error && (
        <div style={{padding:'24px',textAlign:'center',color:'var(--text-muted)',fontSize:'0.875rem'}}>
          {comparison.error}
        </div>
      )}

      {comparison && !comparison.error && !loading && (() => {
        const A = comparison.teamA;
        const B = comparison.teamB;
        const commonIds = new Set(comparison.common.playerIds);
        // Active = mains not swapped out + swapped-in backups
        const activeA = A.players.filter(p => !p.swapped_out && (!p.is_backup || p.swapped_in));
        const activeB = B.players.filter(p => !p.swapped_out && (!p.is_backup || p.swapped_in));
        const backupA = A.players.filter(p => p.is_backup && !p.swapped_in);
        const backupB = B.players.filter(p => p.is_backup && !p.swapped_in);
        // Sort active: common first, then unique
        const commonA = activeA.filter(p => commonIds.has(p.id));
        const uniqueA = activeA.filter(p => !commonIds.has(p.id));
        const uniqueB = activeB.filter(p => !commonIds.has(p.id));
        // Swapped out players shown separately (faded, with OUT badge)
        const swappedOutA = A.players.filter(p => p.swapped_out);
        const swappedOutB = B.players.filter(p => p.swapped_out);

        const commonPtsA = comparison.common.ptsA;
        const commonPtsB = comparison.common.ptsB;
        const uniquePtsA = comparison.teamA.uniquePts;
        const uniquePtsB = comparison.teamB.uniquePts;
        const totalGap   = A.total_fantasy_points - B.total_fantasy_points;

        const maxUnique = Math.max(uniqueA.length, uniqueB.length);

        return (
          <>
            {/* Score bar */}
            <div className="cp-score-bar">
              <div className="cp-score-side">
                <span className="cp-score-name">{A.user_name}</span>
                <span className="cp-score-pts">{A.total_fantasy_points}</span>
                <span className="cp-score-rank">#{leaderboard.findIndex(e=>e.user_id===userA)+1}</span>
              </div>
              <div className="cp-score-mid">
                <span className={`cp-diff-pill ${totalGap > 0 ? 'pos' : totalGap < 0 ? 'neg' : ''}`}>
                  {totalGap > 0 ? '+' : ''}{totalGap} pts
                </span>
              </div>
              <div className="cp-score-side cp-score-right">
                <span className="cp-score-name">{B.user_name}</span>
                <span className="cp-score-pts">{B.total_fantasy_points}</span>
                <span className="cp-score-rank">#{leaderboard.findIndex(e=>e.user_id===userB)+1}</span>
              </div>
            </div>

            {/* Column headers */}
            <div className="cp-col-headers">
              <span className="cp-col-hdr">{A.user_name}</span>
              <span className="cp-col-hdr cp-col-hdr-right">{B.user_name}</span>
            </div>

            {/* Common players section */}
            <div className="cp-group-label">
              <span>🤝 {commonA.length} common players</span>
              <span className="cp-group-diff">
                {commonPtsA} · {commonPtsB}
                <span className={commonPtsA - commonPtsB > 0 ? 'cp-adv-a' : commonPtsA - commonPtsB < 0 ? 'cp-adv-b' : ''}>
                  {commonPtsA !== commonPtsB ? ` (${commonPtsA > commonPtsB ? '+' : ''}${commonPtsA - commonPtsB})` : ''}
                </span>
              </span>
            </div>

            {commonA.map((pA, i) => {
              const pB = activeB.find(p => p.id === pA.id);
              return (
                <div key={pA.id} className="cp-row cp-row-common">
                  <PlayerCell player={pA} side="left" swappedIn={pA.swapped_in} />
                  <PlayerCell player={pB} side="right" swappedIn={pB?.swapped_in} />
                </div>
              );
            })}

            {/* Unique players section */}
            {maxUnique > 0 && (
              <>
                <div className="cp-group-label">
                  <span>⚡ {uniqueA.length + uniqueB.length} unique players</span>
                  <span className="cp-group-diff">
                    {uniquePtsA} · {uniquePtsB}
                    <span className={uniquePtsA - uniquePtsB > 0 ? 'cp-adv-a' : uniquePtsA - uniquePtsB < 0 ? 'cp-adv-b' : ''}>
                      {uniquePtsA !== uniquePtsB ? ` (${uniquePtsA > uniquePtsB ? '+' : ''}${uniquePtsA - uniquePtsB})` : ''}
                    </span>
                  </span>
                </div>

                {Array.from({ length: maxUnique }, (_, i) => (
                  <div key={i} className="cp-row cp-row-unique">
                    {uniqueA[i]
                      ? <PlayerCell player={uniqueA[i]} side="left" swappedIn={uniqueA[i].swapped_in} />
                      : <div className="cp-cell cp-empty">—</div>
                    }
                    {uniqueB[i]
                      ? <PlayerCell player={uniqueB[i]} side="right" swappedIn={uniqueB[i].swapped_in} />
                      : <div className="cp-cell cp-empty cp-cell-right">—</div>
                    }
                  </div>
                ))}
              </>
            )}

            {/* Swapped out section */}
            {(swappedOutA.length > 0 || swappedOutB.length > 0) && (() => {
              const maxOut = Math.max(swappedOutA.length, swappedOutB.length);
              return (
                <>
                  <div className="cp-group-label" style={{opacity:0.6}}>
                    <span>Swapped out</span>
                  </div>
                  {Array.from({ length: maxOut }, (_, i) => (
                    <div key={i} className="cp-row" style={{opacity:0.5}}>
                      {swappedOutA[i]
                        ? <PlayerCell player={swappedOutA[i]} side="left" swappedOut={true} />
                        : <div className="cp-cell cp-empty">—</div>
                      }
                      {swappedOutB[i]
                        ? <PlayerCell player={swappedOutB[i]} side="right" swappedOut={true} />
                        : <div className="cp-cell cp-empty cp-cell-right">—</div>
                      }
                    </div>
                  ))}
                </>
              );
            })()}

            {/* Backups section */}
            {(backupA.length > 0 || backupB.length > 0) && (() => {
              const maxBak = Math.max(backupA.length, backupB.length);
              return (
                <>
                  <div className="cp-group-label" style={{borderTop:'1px dashed var(--border)',marginTop:4}}>
                    <span>Backups</span>
                  </div>
                  {Array.from({ length: maxBak }, (_, i) => {
                    const pA = backupA[i];
                    const pB = backupB[i];
                    const aSwappedIn = pA && swappedInA.has(pA.id);
                    const bSwappedIn = pB && swappedInB.has(pB.id);
                    return (
                      <div key={i} className="cp-row cp-row-backup">
                        {pA
                          ? <PlayerCell player={pA} side="left" isBackup={!aSwappedIn} swappedIn={aSwappedIn} />
                          : <div className="cp-cell cp-empty">—</div>
                        }
                        {pB
                          ? <PlayerCell player={pB} side="right" isBackup={!bSwappedIn} swappedIn={bSwappedIn} />
                          : <div className="cp-cell cp-empty cp-cell-right">—</div>
                        }
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </>
        );
      })()}
    </div>
  );
}

function PlayerCell({ player, side, swappedIn, swappedOut, isBackup }) {
  if (!player) return <div className="cp-cell cp-empty" />;
  const isRight   = side === 'right';
  const isCap     = player.role_in_team === 'captain';
  const isVC      = player.role_in_team === 'vice_captain';
  const isXI      = player.is_playing_xi === 1;
  const pts       = player.effective_pts || 0;
  const parts     = (player.name || '').split(' ');
  const shortName = parts.length === 1 ? parts[0] : parts[0] + ' ' + parts[parts.length-1][0] + '.';

  function Badge() {
    if (swappedIn)  return <div className="cp-badge cp-in">↑</div>;
    if (swappedOut) return <span style={{fontSize:'0.55rem',fontWeight:700,padding:'1px 4px',borderRadius:3,background:'rgba(248,113,113,0.2)',color:'#f87171',whiteSpace:'nowrap'}}>OUT</span>;
    if (isBackup)   return <div className="cp-badge cp-bak">B</div>;
    if (isCap)      return <div className="cp-badge cp-cap">C</div>;
    if (isVC)       return <div className="cp-badge cp-vc">V</div>;
    return <div className="cp-badge cp-none" />;
  }

  return (
    <div className={`cp-cell ${isRight ? 'cp-cell-right' : ''} ${swappedOut ? 'cp-swapped-out' : ''} ${isBackup && !swappedIn ? 'cp-unused-backup' : ''}`}>
      {!isRight && <Badge />}
      <div className={`cp-info ${isRight ? 'cp-info-right' : ''}`}>
        <div style={{display:'flex',alignItems:'center',gap:4,flexDirection:isRight?'row-reverse':'row'}}>
          {isXI && <span style={{width:6,height:6,borderRadius:'50%',background:'#00E5FF',display:'inline-block',flexShrink:0}} />}
          <span className="cp-name" style={{opacity: swappedOut ? 0.4 : isBackup && !swappedIn ? 0.5 : 1}}>{shortName}</span>
        </div>
        <span className="cp-sub">{player.team?.split(' ')[0]} · {player.role?.slice(0,3)}</span>
      </div>
      {isBackup && !swappedIn
        ? <span className="cp-pts" style={{fontSize:'0.65rem',color:'#333',fontStyle:'italic'}}>unused</span>
        : <span className={`cp-pts ${pts > 0 ? 'cp-pts-pos' : pts < 0 ? 'cp-pts-neg' : ''}`} style={{opacity: swappedOut ? 0.4 : 1}}>{pts}</span>
      }
      {isRight && <Badge />}
    </div>
  );
}
