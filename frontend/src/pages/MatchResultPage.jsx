import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../utils/api.js';
import Spinner from '../components/common/Spinner.jsx';
import './MatchResultPage.css';

export default function MatchResultPage() {
  const { matchId } = useParams();
  const navigate    = useNavigate();
  const { user }    = useAuth();
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadResult(); }, [matchId]);

  async function loadResult() {
    try {
      const res = await api.get(`/leaderboard/match/${matchId}/result`);
      setData(res.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  if (loading) return <Spinner center />;
  if (!data)   return <div className="container mt-8 text-center text-secondary">Result not found</div>;

  const { match, rankings, prizePool, topPerformers } = data;
  const myResult  = rankings.find(r => r.user_id === user.id);
  const top3      = rankings.slice(0, 3);

  return (
    <div className="page result-page">
      {/* Header */}
      <div className="result-header">
        <button className="btn-back" onClick={() => navigate('/')}>‹</button>
        <div>
          <h2 className="result-match-title">{match.team_a} vs {match.team_b}</h2>
          <span className="badge badge-muted">Final Result</span>
        </div>
      </div>

      <div className="container">

        {/* My result card */}
        {myResult && (
          <div className={`my-result-card fade-up ${myResult.gross_units > 0 ? 'winner' : ''}`}>
            <div className="my-result-left">
              <span className="my-result-label">Your Result</span>
              <span className="my-result-rank">
                {(() => { const r = myResult.prize_rank || (rankings.indexOf(myResult) + 1); return r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `#${r}`; })()}
              </span>
              <span className="my-result-pts mono">{myResult.total_fantasy_points} pts</span>
            </div>
            <div className="my-result-right">
              {(() => {
                const entryFee = 300;
                const gross = myResult.gross_units ?? 0;
                const net = myResult.net_units ?? (gross - entryFee);
                return <>
                  <span className={`my-result-units ${net >= 0 ? 'text-green' : 'text-red'} mono`}>
                    {net >= 0 ? '+' : ''}{net}
                  </span>
                  <span className="text-muted text-sm">net units</span>
                  {gross > 0 && <span className="badge badge-gold mt-2">Won {gross}u 🎉</span>}
                </>;
              })()}
            </div>
          </div>
        )}

        {/* Podium */}
        <section className="result-section fade-up">
          <h3 className="section-title">Podium</h3>
          <div className="podium">
            {[top3[1], top3[0], top3[2]].filter(Boolean).map((entry, visualIdx) => {
              const podiumPos = visualIdx === 0 ? 2 : visualIdx === 1 ? 1 : 3;
              const actualRank = entry.match_rank || rankings.indexOf(entry) + 1;
              return (
                <div key={entry.user_id} className={`podium-slot pos-${podiumPos}`}>
                  <span className="podium-name truncate">{entry.name}</span>
                  <div className="podium-block">
                    <span className="podium-medal">
                      {podiumPos === 1 ? '🥇' : podiumPos === 2 ? '🥈' : '🥉'}
                    </span>
                    <span className="podium-pts mono">{entry.total_fantasy_points}</span>
                    {entry.gross_units > 0 && (
                      <span className="podium-units badge badge-gold">{entry.gross_units}u</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Prize pool breakdown */}
        {prizePool && (
          <section className="result-section fade-up">
            <h3 className="section-title">Prize Pool</h3>
            <div className="card">
              <div className="prize-row">
                <span className="text-secondary">Total Pool</span>
                <span className="mono text-primary">{prizePool.total_units} units</span>
              </div>
              <div className="prize-row">
                <span className="text-secondary">Participants</span>
                <span className="mono text-primary">{prizePool.participants_count}</span>
              </div>
              <div className="prize-row">
                <span className="text-secondary">Split</span>
                <span className="badge badge-cyan">
                  {prizePool.distribution_rule === '3-winner' ? '50 / 30 / 20' :
                   prizePool.distribution_rule === '2-winner' ? '60 / 40' : 'No prize'}
                </span>
              </div>
            </div>
          </section>
        )}

        {/* Full rankings */}
        <section className="result-section fade-up">
          <h3 className="section-title">Full Rankings</h3>
          <div className="rankings-list">
            {rankings.map((entry, idx) => (
              <div key={entry.user_id} className={`ranking-row card mb-2 ${entry.user_id === user.id ? 'ranking-me' : ''}`}>
                <span className="ranking-pos mono text-muted">
                  {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                </span>
                <div className="ranking-info">
                  <span className="player-name">{entry.name}</span>
                </div>
                <div className="ranking-scores">
                  <span className="mono text-primary">{entry.total_fantasy_points} pts</span>
                  {(() => {
                    const gross = entry.gross_units ?? 0;
                    const net = entry.net_units ?? (gross - 300);
                    return <span className={`mono text-sm ${net >= 0 ? 'text-green' : 'text-red'}`}>
                      {net > 0 ? `+${net}u` : net < 0 ? `${net}u` : '—'}
                    </span>;
                  })()}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 🪣 Basement */}
        {(() => {
          const basementCutoff = Math.ceil(rankings.length / 2);
          const basement = rankings.slice(basementCutoff);
          if (basement.length === 0) return null;
          return (
            <section className="result-section fade-up">
              <h3 className="section-title" style={{display:'flex',alignItems:'center',gap:6}}>
                🪣 Basement
              </h3>
              <div className="card" style={{background:'rgba(248,113,113,0.05)',border:'1px solid rgba(248,113,113,0.15)'}}>
                <p style={{fontSize:'0.75rem',color:'#f87171',marginBottom:8}}>
                  Bottom {basement.length} player{basement.length!==1?'s':''} this match
                </p>
                <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                  {basement.map((e,i) => (
                    <div key={e.user_id} style={{
                      display:'flex',alignItems:'center',gap:6,
                      background:'var(--bg-elevated)',border:'1px solid var(--border)',
                      borderRadius:8,padding:'6px 10px',
                    }}>
                      <span style={{fontSize:'0.8rem'}}>🪣</span>
                      <div>
                        <div style={{fontSize:'0.8rem',fontWeight:500}}>{e.name}</div>
                        <div style={{fontSize:'0.68rem',color:'var(--text-muted)'}}>{e.total_fantasy_points}pts · #{basementCutoff+i+1}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          );
        })()}

        {/* Top performers */}
        {topPerformers?.length > 0 && (
          <section className="result-section fade-up">
            <h3 className="section-title">Top Performers</h3>
            <div className="performers-list">
              {topPerformers.map((p, i) => (
                <div key={p.id} className="performer-row card mb-2">
                  <span className="performer-rank text-muted mono">#{i + 1}</span>
                  <div className="performer-info">
                    <span className="player-name">{p.name}</span>
                    <span className="text-muted text-sm">{p.team}</span>
                  </div>
                  <div className="performer-stats text-sm text-secondary">
                    {p.runs > 0 && <span className="chip">{p.runs}r</span>}
                    {p.wickets > 0 && <span className="chip">{p.wickets}w</span>}
                    {p.catches > 0 && <span className="chip">{p.catches}c</span>}
                  </div>
                  <span className="performer-pts mono text-cyan">{p.fantasy_points}</span>
                </div>
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  );
}
