import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../utils/api.js';
import Spinner from '../components/common/Spinner.jsx';
import './HomePage.css';

export default function HomePage() {
  const { user, seasons, activeSeason, switchSeason } = useAuth();
  const navigate = useNavigate();
  const [matches, setMatches]     = useState([]);
  const [liveScore, setLiveScore] = useState(null); // {teamA: '145/6', teamB: ''}
  const [leaderboard, setBoard]   = useState([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    if (!activeSeason) return;
    loadData();
  }, [activeSeason]);

  async function loadData() {
    setLoading(true);
    try {
      const [mRes, lRes] = await Promise.all([
        api.get(`/matches?seasonId=${activeSeason.id}`),
        api.get(`/leaderboard/season/${activeSeason.id}`),
      ]);
      const allMatches = mRes.data.matches || [];
      setMatches(allMatches);
      // Fetch live score for live match
      const live = allMatches.find(m => m.status === 'live');
      if (live) {
        try {
          const sRes = await api.get(`/matches/${live.id}/scores`);
          const scores = sRes.data.scores || [];
          const teams = {};
          scores.forEach(p => {
            if (!teams[p.team]) teams[p.team] = { runs:0, wkts:0 };
            teams[p.team].runs += p.runs || 0;
            if (p.dismissal_type && !['notout','dnb',''].includes(p.dismissal_type)) teams[p.team].wkts++;
          });
          setLiveScore(teams);
        } catch {}
      }
      setBoard((lRes.data.leaderboard || []).slice(0, 5));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  const liveMatch     = matches.find(m => m.status === 'live');
  const upcomingMatches = matches.filter(m => m.status === 'upcoming').slice(0, 3);
  const recentMatches = matches.filter(m => m.status === 'completed').slice(-3).reverse();

  if (loading) return <Spinner center />;

  return (
    <div className="page home-page">
      <div className="container">

        {/* Header */}
        <header className="home-header fade-up">
          <div>
            <p className="home-greeting">Good game,</p>
            <h1 className="home-username">{user.name}</h1>
          </div>
          <button
            onClick={() => navigate('/faq')}
            style={{background:'none',border:'none',color:'var(--text-muted)',fontSize:'1rem',cursor:'pointer',padding:'4px 6px',borderRadius:'50%',lineHeight:1}}
            title="How it works"
          >?</button>
          {seasons.length > 1 && (
            <select
              className="season-switcher"
              value={activeSeason?.id || ''}
              onChange={e => {
                const s = seasons.find(s => s.id === parseInt(e.target.value));
                if (s) switchSeason(s);
              }}
            >
              {seasons.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </header>

        {/* Live match banner */}
        {liveMatch && (
          <div className="live-banner fade-up" onClick={() => navigate(`/match/${liveMatch.id}/live`)}>
            <div className="live-banner-pulse" />
            <div className="live-banner-content">
              <div className="flex items-center gap-2">
                <span className="status-dot status-live" />
                <span className="live-label">LIVE NOW</span>
              </div>
              <div className="live-teams">
                <span>{liveMatch.team_a}</span>
                {liveScore?.[liveMatch.team_a] && (
                  <span className="live-match-score">{liveScore[liveMatch.team_a].runs}/{liveScore[liveMatch.team_a].wkts}</span>
                )}
                <span className="live-vs">vs</span>
                {liveScore?.[liveMatch.team_b] && (
                  <span className="live-match-score">{liveScore[liveMatch.team_b].runs}/{liveScore[liveMatch.team_b].wkts}</span>
                )}
                <span>{liveMatch.team_b}</span>
              </div>
              {liveMatch.has_team ? (
                <div className="live-my-score">
                  <span className="text-secondary text-sm">My score</span>
                  <span className="live-score-value">{liveMatch.total_fantasy_points || 0} pts</span>
                  {liveMatch.match_rank && (
                    <span className="badge badge-cyan">#{liveMatch.match_rank}</span>
                  )}
                </div>
              ) : (
                <p className="live-no-team">You didn't submit a team for this match</p>
              )}
            </div>
            <span className="live-arrow">›</span>
          </div>
        )}

        {/* Upcoming matches */}
        {upcomingMatches.length > 0 && (
          <section className="home-section fade-up">
            <h2 className="section-title">Upcoming</h2>
            <div className="match-list">
              {upcomingMatches.map(m => (
                <MatchCard key={m.id} match={m} navigate={navigate} />
              ))}
            </div>
          </section>
        )}

        {/* Season standings mini */}
        {leaderboard.length > 0 && (
          <section className="home-section fade-up">
            <div className="section-header">
              <h2 className="section-title">Standings</h2>
              <Link to="/leaderboard" className="section-link">See all →</Link>
            </div>
            <div className="card">
              {leaderboard.map((entry, idx) => (
                <div key={entry.user_id} className={`mini-row ${entry.user_id === user.id ? 'mini-row-me' : ''}`}>
                  <span className="mini-rank">
                    {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                  </span>
                  <span className="mini-name truncate">{entry.name}</span>
                  <span className={`mini-score mono ${entry.net_units >= 0 ? 'text-green' : 'text-red'}`}>
                    {entry.net_units >= 0 ? '+' : ''}{entry.net_units}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Recent results */}
        {recentMatches.length > 0 && (
          <section className="home-section fade-up">
            <h2 className="section-title">Recent Results</h2>
            <div className="match-list">
              {recentMatches.map(m => (
                <MatchCard key={m.id} match={m} navigate={navigate} />
              ))}
            </div>
          </section>
        )}

        {matches.length === 0 && !loading && (
          <div className="home-empty">
            <span style={{fontSize:'3rem'}}>🏏</span>
            <p>No matches scheduled yet.</p>
            <p className="text-secondary text-sm">Check back soon!</p>
          </div>
        )}

      </div>
    </div>
  );
}

function MatchCard({ match, navigate }) {
  const isCompleted = match.status === 'completed';
  const isUpcoming  = match.status === 'upcoming';

  const dest = isUpcoming
    ? `/match/${match.id}/pick`
    : `/match/${match.id}/live`;

  const startTime = new Date(match.start_time);
  const timeStr   = startTime.toLocaleDateString('en-IN', { day:'numeric', month:'short' })
    + ' · ' + startTime.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });

  return (
    <div className="match-card" onClick={() => navigate(dest)}>
      <div className="match-card-left">
        <div className="match-teams">
          <span>{match.team_a}</span>
          <span className="match-vs">v</span>
          <span>{match.team_b}</span>
        </div>
        <span className="match-time text-muted text-sm">{timeStr}</span>
      </div>
      <div className="match-card-right">
        {match.has_team ? (
          <div className="match-my-status">
            <span className="match-pts mono">{match.total_fantasy_points || 0}</span>
            <span className="text-muted" style={{fontSize:'0.7rem'}}>PTS</span>
          </div>
        ) : isUpcoming ? (
          <span className="badge badge-cyan">Pick Team</span>
        ) : (
          <span className="badge badge-muted">No team</span>
        )}
        <span className="match-arrow">›</span>
      </div>
    </div>
  );
}
