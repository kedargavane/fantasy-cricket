import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../utils/api.js';
import Spinner from '../components/common/Spinner.jsx';
import './LeaderboardPage.css';

const SORT_OPTIONS = [
  { key: 'season_score', label: 'Season Score' },
  { key: 'net_units',    label: 'Net Units' },
  { key: 'total_fantasy_points', label: 'Fantasy Pts' },
  { key: 'top_finishes', label: 'Top Finishes' },
];

export default function LeaderboardPage() {
  const { activeSeason, user } = useAuth();
  const [data, setData]     = useState(null);
  const [form, setForm]     = useState({});
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('net_units');

  useEffect(() => {
    if (!activeSeason) return;
    loadLeaderboard();
  }, [activeSeason]);

  async function loadLeaderboard() {
    setLoading(true);
    try {
      const [lbRes, formRes] = await Promise.all([
        api.get(`/leaderboard/season/${activeSeason.id}`),
        api.get(`/leaderboard/season/${activeSeason.id}/form`),
      ]);
      setData(lbRes.data);
      // Index form by user_id
      const formMap = {};
      for (const f of (formRes.data.form || [])) {
        formMap[f.user_id] = f.last5;
      }
      setForm(formMap);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  if (loading) return <Spinner center />;
  if (!data)   return <div className="container mt-8 text-center text-secondary">No season data</div>;

  const { leaderboard, season, totalCompleted, minMatchesRequired } = data;

  const sorted = [...leaderboard].sort((a, b) => {
    if (a.is_eligible !== b.is_eligible) return b.is_eligible - a.is_eligible;
    return b[sortBy] - a[sortBy];
  });

  const myEntry = sorted.find(e => e.user_id === user.id);

  return (
    <div className="page lb-page">
      <div className="container">

        <header className="lb-header fade-up">
          <h1 className="lb-title">{season.name}</h1>
          <p className="text-secondary text-sm">
            {totalCompleted} match{totalCompleted !== 1 ? 'es' : ''} played
            {minMatchesRequired > 0 && ` · Min ${minMatchesRequired} for ranking`}
          </p>
        </header>

        {/* My position highlight */}
        {myEntry && (
          <div className="my-standing fade-up">
            <div className="my-standing-rank">
              <span className="standing-medal">
                {myEntry.display_rank === 1 ? '🥇' :
                 myEntry.display_rank === 2 ? '🥈' :
                 myEntry.display_rank === 3 ? '🥉' :
                 myEntry.display_rank ? `#${myEntry.display_rank}` : '—'}
              </span>
              <span className="text-muted text-sm">Your rank</span>
            </div>
            <div className="my-standing-stats">
              <StatPill
                label="Season Score"
                value={myEntry.season_score >= 0 ? `+${myEntry.season_score}` : myEntry.season_score}
                color={myEntry.season_score >= 0 ? 'green' : 'red'}
              />
              <StatPill label="Played" value={myEntry.matches_played} />
              <StatPill label="Top Finishes" value={myEntry.top_finishes} color="gold" />
            </div>
          </div>
        )}

        {/* Sort options */}
        <div className="lb-sort fade-up">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              className={`sort-btn ${sortBy === opt.key ? 'active' : ''}`}
              onClick={() => setSortBy(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Leaderboard rows */}
        <div className="lb-list fade-up">
          {sorted.map((entry, idx) => {
            const isMe = entry.user_id === user.id;
            const netPositive = entry.net_units >= 0;

            return (
              <div key={entry.user_id} className={`lb-entry ${isMe ? 'lb-entry-me' : ''} ${!entry.is_eligible ? 'lb-entry-ineligible' : ''}`}>
                <div className="lbe-rank">
                  {entry.is_eligible ? (
                    <span className="rank-display">
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${entry.display_rank || idx + 1}`}
                    </span>
                  ) : (
                    <span className="rank-display text-muted">—</span>
                  )}
                </div>

                <div className="lbe-info">
                  <div className="lbe-name-row">
                    <span className="lbe-name">{entry.name}</span>
                    {!entry.is_eligible && (
                      <span className="badge badge-muted" style={{fontSize:'0.65rem'}}>
                        {entry.matches_played}/{minMatchesRequired} matches
                      </span>
                    )}
                  </div>
                  {/* Form dots — last 5 match ranks */}
                  {form[entry.user_id] && (
                    <div style={{display:'flex',gap:3,margin:'4px 0 2px'}}>
                      {form[entry.user_id].map((f, i) => {
                        if (!f) return <div key={i} style={{width:16,height:16,borderRadius:'50%',background:'#eef1f8',display:'flex',alignItems:'center',justifyContent:'center',fontSize:7,color:'#c0c8e0',fontWeight:700}}>—</div>;
                        const r = f.rank || 99;
                        const bg = r === 1 ? '#1a6fd4' : r <= 3 ? '#6baed6' : r >= (sorted.length - 1) ? '#fde8e8' : '#eef1f8';
                        const col = r === 1 ? '#fff' : r <= 3 ? '#fff' : r >= (sorted.length - 1) ? '#d42020' : '#4a5a7a';
                        return <div key={i} style={{width:16,height:16,borderRadius:'50%',background:bg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:7,color:col,fontWeight:700}}>{r}</div>;
                      })}
                    </div>
                  )}
                  {/* Mini bar chart — net units relative to max */}
                  <div className="lbe-bar-track">
                    <div
                      className={`lbe-bar ${netPositive ? 'positive' : 'negative'}`}
                      style={{
                        width: `${Math.min(Math.abs(entry.net_units) / Math.max(...sorted.map(e => Math.abs(e.net_units)), 1) * 100, 100)}%`
                      }}
                    />
                  </div>
                </div>

                <div className="lbe-stats">
                  <span className={`lbe-primary mono ${netPositive ? 'text-green' : 'text-red'}`}>
                    {sortBy === 'season_score'
                      ? (entry.season_score >= 0 ? `+${entry.season_score}` : entry.season_score)
                      : sortBy === 'net_units'
                        ? (netPositive ? `+${entry.net_units}` : entry.net_units)
                        : sortBy === 'top_finishes'
                          ? `${entry.top_finishes}🏆`
                          : entry.total_fantasy_points
                    }
                  </span>
                  <span className="lbe-secondary text-muted text-sm mono">
                    {entry.matches_played}M
                  </span>
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}

function StatPill({ label, value, color = 'default' }) {
  const colorMap = { green: 'text-green', gold: 'text-gold', red: 'text-red', default: 'text-primary' };
  return (
    <div className="stat-pill">
      <span className={`stat-pill-value mono ${colorMap[color]}`}>{value}</span>
      <span className="stat-pill-label text-muted">{label}</span>
    </div>
  );
}
