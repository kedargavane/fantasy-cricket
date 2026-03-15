import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../../utils/api.js';
import Spinner from '../../components/common/Spinner.jsx';
import './AdminPages.css';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showSeriesForm, setShowSeriesForm] = useState(false);
  const [syncMsg, setSyncMsg]   = useState('');
  const [syncing, setSyncing]   = useState(false);

  useEffect(() => { loadDashboard(); }, []);

  async function loadDashboard() {
    try {
      const res = await api.get('/admin/dashboard');
      setData(res.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function triggerSync() {
    if (!data?.season) return;
    setSyncing(true);
    setSyncMsg('');
    try {
      const res = await api.post(`/admin/seasons/${data.season.id}/sync-schedule`);
      setSyncMsg(`✓ Sync complete — ${res.data.totalCreated} new, ${res.data.totalUpdated} updated, ${res.data.totalSquadsSynced} squads`);
      loadDashboard();
    } catch (err) {
      setSyncMsg('✗ ' + (err.response?.data?.error || 'Sync failed'));
    } finally { setSyncing(false); }
  }

  if (loading) return <Spinner center />;

  const { season, stats, liveMatch, upcomingMatches, recentMatches } = data || {};

  return (
    <div className="page admin-page">
      <div className="container">

        <header className="admin-header fade-up">
          <div>
            <h1 className="admin-title">Admin</h1>
            {season && <p className="text-secondary text-sm">{season.name} · {season.invite_code}</p>}
          </div>
          <div className="flex gap-2">
            <Link to="/admin/discover" className="btn btn-secondary btn-sm">🔍 Discover</Link>
            <Link to="/admin/users" className="btn btn-ghost btn-sm">Users</Link>
            <Link to="/" className="btn btn-ghost btn-sm">← App</Link>
          </div>
        </header>

        {/* Stats grid */}
        {stats && (
          <div className="stats-grid fade-up">
            <StatCard label="Members"       value={stats.totalMembers} />
            <StatCard label="Matches"       value={`${stats.completedMatches}/${stats.totalMatches}`} />
            <StatCard label="Live"          value={stats.liveMatches} highlight={stats.liveMatches > 0} />
            <StatCard label="Units in Play" value={stats.totalUnitsInPlay} />
          </div>
        )}

        {/* Live match banner */}
        {liveMatch && (
          <div className="admin-live-banner fade-up" onClick={() => navigate(`/admin/match/${liveMatch.id}`)}>
            <div className="flex items-center gap-2">
              <span className="status-dot status-live" />
              <span className="text-sm font-bold text-green">LIVE</span>
            </div>
            <span className="font-bold">{liveMatch.team_a} vs {liveMatch.team_b}</span>
            <span className="btn btn-sm btn-secondary">Manage →</span>
          </div>
        )}

        {/* Auto-schedule section */}
        {season && (
          <section className="admin-section fade-up">
            <div className="section-header">
              <h2 className="section-title">Auto-Schedule</h2>
              <div className="flex gap-2">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowSeriesForm(s => !s)}
                >
                  {showSeriesForm ? 'Close' : '⚙ Series IDs'}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={triggerSync}
                  disabled={syncing}
                >
                  {syncing ? 'Syncing...' : '↻ Sync Now'}
                </button>
              </div>
            </div>

            {syncMsg && (
              <div className={`settings-msg ${syncMsg.startsWith('✓') ? 'success' : 'error'} mb-3`}>
                {syncMsg}
              </div>
            )}

            <div className="card mb-3">
              <p className="text-secondary text-sm">
                Matches are auto-discovered from CricAPI every hour based on the series IDs below.
                Squads are auto-synced 48 hours before each match.
              </p>
              {season.series_ids && JSON.parse(season.series_ids || '[]').length > 0 ? (
                <div className="mt-3">
                  <p className="text-muted text-sm mb-2" style={{textTransform:'uppercase',letterSpacing:'0.06em'}}>Configured Series</p>
                  {JSON.parse(season.series_ids).map(id => (
                    <div key={id} className="series-id-chip">
                      <span className="mono text-sm">{id}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted text-sm mt-2">No series IDs configured yet. Add them to enable auto-schedule.</p>
              )}
            </div>

            {showSeriesForm && (
              <SeriesIdsForm
                season={season}
                onSaved={() => { setShowSeriesForm(false); loadDashboard(); }}
              />
            )}
          </section>
        )}

        {/* Matches section */}
        <section className="admin-section fade-up">
          <div className="section-header">
            <h2 className="section-title">Matches</h2>
            <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(s => !s)}>
              {showCreate ? 'Cancel' : '+ Manual'}
            </button>
          </div>

          {showCreate && season && (
            <CreateMatchForm
              seasonId={season.id}
              onCreated={() => { setShowCreate(false); loadDashboard(); }}
              onCancel={() => setShowCreate(false)}
            />
          )}

          {upcomingMatches?.length > 0 && (
            <>
              <p className="admin-list-label">Upcoming</p>
              {upcomingMatches.map(m => (
                <AdminMatchRow key={m.id} match={m} navigate={navigate} />
              ))}
            </>
          )}

          {recentMatches?.length > 0 && (
            <>
              <p className="admin-list-label mt-4">Recent</p>
              {recentMatches.map(m => (
                <AdminMatchRow key={m.id} match={m} navigate={navigate} />
              ))}
            </>
          )}

          {!upcomingMatches?.length && !recentMatches?.length && (
            <div className="card text-center text-secondary">
              No matches yet. Add series IDs above or create one manually.
            </div>
          )}
        </section>

      </div>
    </div>
  );
}

// ── Series IDs form ───────────────────────────────────────────────────────────
function SeriesIdsForm({ season, onSaved }) {
  const existing = JSON.parse(season.series_ids || '[]');
  const [ids, setIds]     = useState(existing.join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  async function save(e) {
    e.preventDefault();
    const parsed = ids.split('\n').map(s => s.trim()).filter(Boolean);
    if (parsed.length === 0) return setError('Enter at least one series ID');
    setSaving(true);
    try {
      await api.patch(`/admin/seasons/${season.id}`, { seriesIds: parsed });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="card mb-4">
      <p className="text-sm text-secondary mb-3">
        Enter one CricAPI series ID per line. Find series IDs at{' '}
        <a href="https://cricketdata.org/cricket-data-formats/series" target="_blank" rel="noreferrer" className="text-cyan">
          cricketdata.org/series
        </a>
      </p>
      <div className="input-group mb-3">
        <label className="input-label">Series IDs (one per line)</label>
        <textarea
          className="input"
          rows={4}
          value={ids}
          onChange={e => setIds(e.target.value)}
          placeholder={'e.g.\nab12cd34-...\nef56gh78-...'}
          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', resize: 'vertical' }}
        />
      </div>
      {error && <p className="auth-error mb-3">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
          {saving ? 'Saving...' : 'Save Series IDs'}
        </button>
      </div>
      <p className="text-muted text-sm mt-3">
        💡 For today's LLC match: series ID is in the CricAPI match URL after the last hyphen grouping.
        Example for IPL 2026: find it at cricketdata.org/series and paste here.
      </p>
    </form>
  );
}

// ── Shared components ─────────────────────────────────────────────────────────
function StatCard({ label, value, highlight }) {
  return (
    <div className={`stat-card card ${highlight ? 'stat-highlight' : ''}`}>
      <span className={`stat-value mono ${highlight ? 'text-green' : ''}`}>{value}</span>
      <span className="stat-label text-muted text-sm">{label}</span>
    </div>
  );
}

function AdminMatchRow({ match, navigate }) {
  const statusColors = { live: 'green', upcoming: 'cyan', completed: 'muted', abandoned: 'red' };
  const color = statusColors[match.status] || 'muted';
  return (
    <div className="admin-match-row card mb-2" onClick={() => navigate(`/admin/match/${match.id}`)}>
      <div className="flex-col gap-1 flex-1">
        <span className="font-bold text-sm">{match.team_a} vs {match.team_b}</span>
        <span className="text-muted text-sm">
          {new Date(match.start_time).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
          })}
          {' · '}{match.team_count || 0} teams · {match.xi_count || 0} XI set
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className={`badge badge-${color}`}>{match.status}</span>
        <span className="text-muted">›</span>
      </div>
    </div>
  );
}

function CreateMatchForm({ seasonId, onCreated, onCancel }) {
  const [form, setForm] = useState({
    externalMatchId: '', teamA: '', teamB: '', venue: '',
    matchType: 't20', startTime: '', entryUnits: 300,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const handle = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/admin/matches', { ...form, seasonId });
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create match');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="create-match-form card mb-4">
      <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--accent-primary)' }}>Manual Match Entry</h3>
      <div className="form-grid">
        <div className="input-group">
          <label className="input-label">CricAPI Match ID</label>
          <input className="input" name="externalMatchId" value={form.externalMatchId} onChange={handle} placeholder="UUID from CricAPI" required />
        </div>
        <div className="input-group">
          <label className="input-label">Match Type</label>
          <select className="input" name="matchType" value={form.matchType} onChange={handle}>
            <option value="t20">T20</option>
            <option value="odi">ODI</option>
            <option value="test">Test</option>
          </select>
        </div>
        <div className="input-group">
          <label className="input-label">Team A</label>
          <input className="input" name="teamA" value={form.teamA} onChange={handle} placeholder="e.g. RCB" required />
        </div>
        <div className="input-group">
          <label className="input-label">Team B</label>
          <input className="input" name="teamB" value={form.teamB} onChange={handle} placeholder="e.g. MI" required />
        </div>
        <div className="input-group">
          <label className="input-label">Start Time</label>
          <input className="input" name="startTime" type="datetime-local" value={form.startTime} onChange={handle} required />
        </div>
        <div className="input-group">
          <label className="input-label">Entry Units</label>
          <input className="input" name="entryUnits" type="number" value={form.entryUnits} onChange={handle} min={50} />
        </div>
        <div className="input-group" style={{ gridColumn: '1/-1' }}>
          <label className="input-label">Venue</label>
          <input className="input" name="venue" value={form.venue} onChange={handle} placeholder="Stadium name" />
        </div>
      </div>
      {error && <p className="auth-error mt-3">{error}</p>}
      <div className="flex gap-2 mt-4">
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
          {saving ? 'Creating...' : 'Create Match'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
