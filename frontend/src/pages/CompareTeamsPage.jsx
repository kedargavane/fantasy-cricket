import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../utils/api.js';
import Spinner from '../components/common/Spinner.jsx';
import './CompareTeamsPage.css';

export default function CompareTeamsPage() {
  const { matchId }    = useParams();
  const navigate       = useNavigate();
  const { user, activeSeason } = useAuth();

  const [leaderboard, setLeaderboard] = useState([]);
  const [userA, setUserA] = useState(null);
  const [userB, setUserB] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading]     = useState(false);
  const [lbLoading, setLbLoading] = useState(true);

  useEffect(() => { loadLeaderboard(); }, [matchId]);

  useEffect(() => {
    if (userA && userB && userA !== userB) {
      loadComparison();
    } else {
      setComparison(null);
    }
  }, [userA, userB]);

  async function loadLeaderboard() {
    setLbLoading(true);
    try {
      const res = await api.get(`/matches/${matchId}/leaderboard`);
      const lb = res.data.leaderboard || [];
      setLeaderboard(lb);
      // Default: current user vs #1 (or #2 if current user is #1)
      const me = lb.find(e => e.user_id === user.id);
      const other = lb.find(e => e.user_id !== user.id);
      if (me)    setUserA(me.user_id);
      if (other) setUserB(other.user_id);
    } catch (e) { console.error(e); }
    finally { setLbLoading(false); }
  }

  async function loadComparison() {
    setLoading(true);
    setComparison(null);
    try {
      const res = await api.get(`/teams/compare/${matchId}?userA=${userA}&userB=${userB}`);
      setComparison(res.data);
    } catch (err) {
      if (err.response?.status === 403) {
        setComparison({ error: err.response.data.error });
      }
    } finally {
      setLoading(false);
    }
  }

  if (lbLoading) return <Spinner center />;

  return (
    <div className="page compare-page">
      <div className="compare-header">
        <button className="btn-back" onClick={() => navigate(`/match/${matchId}/live`)}>‹</button>
        <h2 className="compare-title">Compare Teams</h2>
      </div>

      <div className="container">

        {/* User selectors */}
        <div className="compare-selectors fade-up">
          <UserSelector
            label="Team A"
            users={leaderboard}
            selected={userA}
            onSelect={setUserA}
            exclude={userB}
            accentClass="selector-a"
          />
          <div className="compare-vs-badge">VS</div>
          <UserSelector
            label="Team B"
            users={leaderboard}
            selected={userB}
            onSelect={setUserB}
            exclude={userA}
            accentClass="selector-b"
          />
        </div>

        {/* Legend */}
        {comparison && !comparison.error && (
          <div className="compare-legend fade-up">
            <span className="legend-item"><span className="legend-dot dot-common" />Common</span>
            <span className="legend-item"><span className="legend-dot dot-a" />A only</span>
            <span className="legend-item"><span className="legend-dot dot-b" />B only</span>
          </div>
        )}

        {loading && <Spinner center />}

        {comparison?.error && (
          <div className="card text-center text-secondary mt-4">
            {comparison.error}
          </div>
        )}

        {comparison && !comparison.error && !loading && (
          <>
            {/* Score header */}
            <div className="compare-score-row fade-up">
              <div className="compare-score-card score-a">
                <span className="score-name">{comparison.teamA.user_name}</span>
                <span className="score-pts">{comparison.teamA.total_fantasy_points}</span>
                <span className="score-label">pts · #{comparison.teamA.match_rank || '—'}</span>
              </div>
              <div className="compare-gap">
                <span className={`gap-value ${comparison.analysis.totalGap > 0 ? 'text-green' : comparison.analysis.totalGap < 0 ? 'text-red' : 'text-muted'}`}>
                  {comparison.analysis.totalGap > 0 ? '+' : ''}{comparison.analysis.totalGap}
                </span>
                <span className="text-muted" style={{fontSize:'0.7rem'}}>gap</span>
              </div>
              <div className="compare-score-card score-b">
                <span className="score-name">{comparison.teamB.user_name}</span>
                <span className="score-pts">{comparison.teamB.total_fantasy_points}</span>
                <span className="score-label">pts · #{comparison.teamB.match_rank || '—'}</span>
              </div>
            </div>

            {/* Side by side teams */}
            <div className="compare-grid fade-up">
              <TeamColumn
                team={comparison.teamA}
                commonIds={new Set(comparison.common.playerIds)}
                side="a"
              />
              <TeamColumn
                team={comparison.teamB}
                commonIds={new Set(comparison.common.playerIds)}
                side="b"
              />
            </div>

            {/* Common players */}
            {comparison.common.count > 0 && (
              <div className="common-section card fade-up">
                <p className="common-title">{comparison.common.count} common players</p>
                <div className="common-chips">
                  {comparison.teamA.players
                    .filter(p => comparison.common.playerIds.includes(p.id))
                    .map(p => (
                      <div key={p.id} className="common-chip">
                        <span className="common-chip-name">{p.name.split(' ').pop()}</span>
                        <span className="common-chip-pts">{p.effective_pts}pts</span>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}

            {/* Analysis */}
            <div className="analysis-section card fade-up">
              <p className="analysis-title">Key differences</p>
              <AnalysisRow
                label="Captain (A)"
                value={comparison.analysis.captainA
                  ? `${comparison.analysis.captainA.name} — ${comparison.analysis.captainA.pts}pts`
                  : '—'}
              />
              <AnalysisRow
                label="Captain (B)"
                value={comparison.analysis.captainB
                  ? `${comparison.analysis.captainB.name} — ${comparison.analysis.captainB.pts}pts`
                  : '—'}
              />
              <AnalysisRow
                label="Unique players delta"
                value={`${comparison.analysis.uniquePtsDelta > 0 ? '+' : ''}${comparison.analysis.uniquePtsDelta} pts`}
                highlight={comparison.analysis.uniquePtsDelta}
              />
              <AnalysisRow
                label="Captain advantage"
                value={`${(comparison.analysis.captainA?.pts || 0) - (comparison.analysis.captainB?.pts || 0) > 0 ? 'A leads' : 'B leads'} by ${Math.abs((comparison.analysis.captainA?.pts || 0) - (comparison.analysis.captainB?.pts || 0))} pts`}
              />
              <AnalysisRow
                label="Total gap"
                value={`${Math.abs(comparison.analysis.totalGap)} pts — ${comparison.analysis.totalGap >= 0 ? comparison.teamA.user_name : comparison.teamB.user_name} leads`}
                highlight={comparison.analysis.totalGap}
              />
            </div>
          </>
        )}

        {!userA || !userB || userA === userB ? (
          <div className="card text-center text-secondary mt-4">
            Select two different players above to compare their teams.
          </div>
        ) : null}

      </div>
    </div>
  );
}

function UserSelector({ label, users, selected, onSelect, exclude, accentClass }) {
  return (
    <div className={`user-selector ${accentClass}`}>
      <span className="selector-label">{label}</span>
      <select
        className="input selector-select"
        value={selected || ''}
        onChange={e => onSelect(parseInt(e.target.value))}
      >
        <option value="">Select player</option>
        {users
          .filter(u => u.user_id !== exclude)
          .map(u => (
            <option key={u.user_id} value={u.user_id}>
              {u.name} ({u.total_fantasy_points}pts)
            </option>
          ))
        }
      </select>
    </div>
  );
}

function TeamColumn({ team, commonIds, side }) {
  return (
    <div className="team-col">
      <div className="team-col-header">
        <span className="team-col-name">{team.user_name}</span>
        <span className="team-col-pts mono">{team.total_fantasy_points}pts</span>
      </div>
      {team.players.map(p => {
        const isCommon = commonIds.has(p.id);
        const rowClass = isCommon ? 'cp-row common' : `cp-row unique-${side}`;
        return (
          <div key={p.id} className={rowClass}>
            <div className="cp-left">
              {p.role_in_team === 'captain'      && <span className="role-dot cap-dot">C</span>}
              {p.role_in_team === 'vice_captain' && <span className="role-dot vc-dot">V</span>}
              {p.role_in_team === 'normal'       && <span className="role-dot empty-dot" />}
              <span className="cp-name">{p.name.split(' ').pop()}</span>
            </div>
            <span className="cp-pts mono">{p.effective_pts || 0}</span>
          </div>
        );
      })}
    </div>
  );
}

function AnalysisRow({ label, value, highlight }) {
  const color = highlight > 0 ? 'text-green' : highlight < 0 ? 'text-red' : '';
  return (
    <div className="analysis-row">
      <span className="analysis-label text-secondary text-sm">{label}</span>
      <span className={`analysis-value text-sm mono ${color}`}>{value}</span>
    </div>
  );
}
