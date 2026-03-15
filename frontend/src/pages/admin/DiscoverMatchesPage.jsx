import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../utils/api.js';
import Spinner from '../../components/common/Spinner.jsx';
import './AdminPages.css';
import './DiscoverPage.css';

const TYPE_FILTERS = ['All', 'T20', 'ODI', 'Test'];

export default function DiscoverMatchesPage() {
  const navigate          = useNavigate();
  const { activeSeason }  = useAuth();
  const [matches, setMatches]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [approving, setApproving] = useState(null);
  const [typeFilter, setTypeFilter] = useState('All');
  const [msg, setMsg]           = useState({ type: '', text: '' });

  useEffect(() => {
    if (activeSeason) loadMatches();
  }, [activeSeason, typeFilter]);

  async function loadMatches() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ seasonId: activeSeason.id });
      if (typeFilter !== 'All') params.set('type', typeFilter.toLowerCase());
      const res = await api.get(`/admin/discover?${params}`);
      setMatches(res.data.matches || []);
    } catch (err) {
      flash('error', err.response?.data?.error || 'Failed to load matches');
    } finally {
      setLoading(false);
    }
  }

  function flash(type, text) {
    setMsg({ type, text });
    setTimeout(() => setMsg({ type: '', text: '' }), 4000);
  }

  async function approve(match) {
    setApproving(match.externalMatchId);
    try {
      const res = await api.post('/admin/discover/approve', {
        seasonId:        activeSeason.id,
        externalMatchId: match.externalMatchId,
        teamA:           match.teamA,
        teamB:           match.teamB,
        venue:           match.venue,
        matchType:       match.matchType,
        startTime:       match.startTime,
        entryUnits:      300,
      });
      flash('success', `${match.teamA} vs ${match.teamB} added to season`);
      // Mark as added in local state
      setMatches(ms => ms.map(m =>
        m.externalMatchId === match.externalMatchId
          ? { ...m, alreadyAdded: true }
          : m
      ));
    } catch (err) {
      flash('error', err.response?.data?.error || 'Failed to approve match');
    } finally {
      setApproving(null);
    }
  }

  const filtered = typeFilter === 'All'
    ? matches
    : matches.filter(m => m.matchType === typeFilter.toLowerCase());

  return (
    <div className="page admin-page">
      <div className="container">

        <header className="admin-header fade-up">
          <div>
            <button className="btn-back" onClick={() => navigate('/admin')} style={{fontSize:'1.5rem',background:'none',border:'none',cursor:'pointer',color:'var(--text-secondary)'}}>‹</button>
            <h1 className="admin-title" style={{display:'inline',marginLeft:'var(--space-2)'}}>Discover Matches</h1>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={loadMatches}>↻ Refresh</button>
        </header>

        <p className="text-secondary text-sm mb-4 fade-up">
          Browse upcoming matches from CricAPI. Click <strong>Add to Season</strong> to let players pick teams.
        </p>

        {msg.text && (
          <div className={`settings-msg ${msg.type} mb-4 fade-up`}>{msg.text}</div>
        )}

        {/* Type filter */}
        <div className="discover-filters fade-up">
          {TYPE_FILTERS.map(f => (
            <button
              key={f}
              className={`filter-btn ${typeFilter === f ? 'active' : ''}`}
              onClick={() => setTypeFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>

        {loading ? <Spinner center /> : (
          <div className="discover-list fade-up">
            {filtered.length === 0 && (
              <div className="card text-center text-secondary">
                No upcoming {typeFilter !== 'All' ? typeFilter : ''} matches found
              </div>
            )}

            {filtered.map(m => {
              const startTime = m.startTime ? new Date(m.startTime) : null;
              const isApproving = approving === m.externalMatchId;

              return (
                <div key={m.externalMatchId} className={`discover-card card ${m.alreadyAdded ? 'already-added' : ''}`}>
                  <div className="discover-card-top">
                    <div className="discover-match-info">
                      <div className="discover-teams">
                        <span>{m.teamA}</span>
                        <span className="discover-vs">vs</span>
                        <span>{m.teamB}</span>
                      </div>
                      <div className="discover-meta">
                        <span className={`badge badge-${m.matchType === 't20' ? 'cyan' : m.matchType === 'odi' ? 'gold' : 'muted'}`}>
                          {m.matchType.toUpperCase()}
                        </span>
                        {startTime && (
                          <span className="text-muted text-sm">
                            {startTime.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                            {' · '}
                            {startTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} IST
                          </span>
                        )}
                        {m.status === 'live' && (
                          <span className="flex items-center gap-1">
                            <span className="status-dot status-live" />
                            <span className="text-sm" style={{color:'var(--accent-green)'}}>Live</span>
                          </span>
                        )}
                      </div>
                      {m.venue && (
                        <p className="text-muted text-sm discover-venue">{m.venue}</p>
                      )}
                      {m.seriesName && (
                        <p className="text-muted text-sm discover-series">{m.seriesName}</p>
                      )}
                    </div>

                    <div className="discover-action">
                      {m.alreadyAdded ? (
                        <span className="badge badge-green" style={{padding:'8px 14px'}}>✓ Added</span>
                      ) : (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => approve(m)}
                          disabled={isApproving}
                        >
                          {isApproving
                            ? <span className="spinner" style={{width:14,height:14,borderWidth:2}} />
                            : '+ Add to Season'
                          }
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
