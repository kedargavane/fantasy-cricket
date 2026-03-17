import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../utils/api.js';

const QUICK_SERIES = [
  { label: 'LLC 2026',       id: '1805' },
  { label: 'IPL 2026',       id: '1795' },
  { label: 'SA vs NZ T20I',  id: '1715' },
  { label: 'T20I 2026',      id: '1715' },
];

export default function SeriesImportPage() {
  const navigate               = useNavigate();
  const { seasons, activeSeason } = useAuth();
  const [smSeasonId, setSmSeasonId] = useState('');
  const [targetSeasonId, setTargetSeasonId] = useState(activeSeason?.id || '');
  const [matches, setMatches]   = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading]   = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState('');

  const [filter, setFilter] = useState('');

  async function preview() {
    if (!smSeasonId.trim()) return setError('Enter a Sportmonks season ID');
    setError(''); setMatches(null); setSelected(new Set()); setResult(null);
    setLoading(true);
    try {
      const res = await api.post('/admin/series/preview', { seasonId: smSeasonId.trim() });
      const ms  = res.data.matches || [];
      setMatches(ms);
      // Auto-select upcoming matches not already added
      const autoSelect = new Set(
        ms.filter(m => !m.alreadyAdded && m.status === 'NS').map(m => m.sportmonksFixtureId)
      );
      setSelected(autoSelect);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to fetch season');
    } finally { setLoading(false); }
  }

  async function importSelected() {
    if (selected.size === 0) return setError('Select at least one match');
    if (!targetSeasonId) return setError('Select a season to import into');
    setError(''); setImporting(true);
    try {
      // Send full fixture objects so backend doesn't need to re-fetch team names
      const selectedFixtures = (matches || []).filter(m => selected.has(m.sportmonksFixtureId));
      const res = await api.post('/admin/series/import', {
        seasonId:  parseInt(targetSeasonId),
        fixtures:  selectedFixtures,
      });
      setResult(res.data);
      preview();
    } catch (e) {
      setError(e.response?.data?.error || 'Import failed');
    } finally { setImporting(false); }
  }

  function toggleMatch(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll() {
    const available = (matches || []).filter(m => !m.alreadyAdded).map(m => m.sportmonksFixtureId);
    setSelected(new Set(available));
  }

  return (
    <div className="page admin-page">
      <div className="admin-header">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/admin')}>← Admin</button>
        <h1 className="admin-title">Import Fixtures</h1>
      </div>

      <div className="container" style={{maxWidth:600,padding:'16px'}}>

        {/* Quick select */}
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
          {QUICK_SERIES.map(s => (
            <button key={s.label} className="btn btn-secondary btn-sm"
              onClick={() => setSmSeasonId(s.id)}>
              {s.label}
            </button>
          ))}
        </div>

        {/* Season ID input */}
        <div style={{display:'flex',gap:8,marginBottom:12}}>
          <input className="input" placeholder="Sportmonks season ID (e.g. 1805)"
            value={smSeasonId} onChange={e => setSmSeasonId(e.target.value)}
            style={{flex:1}} onKeyDown={e => e.key === 'Enter' && preview()} />
          <button className="btn btn-primary" onClick={preview} disabled={loading}>
            {loading ? '...' : 'Preview'}
          </button>
        </div>

        {/* Target season */}
        <div style={{marginBottom:16}}>
          <label className="text-muted text-sm">Import into season:</label>
          <select className="input" value={targetSeasonId}
            onChange={e => setTargetSeasonId(e.target.value)} style={{marginTop:4}}>
            <option value="">-- Select season --</option>
            {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {error && <div className="card" style={{color:'#f87171',marginBottom:12}}>{error}</div>}
        {result && (
          <div className="card" style={{color:'var(--accent-green)',marginBottom:12}}>
            {result.message} — {result.results?.filter(r => r.status === 'imported').length} imported
          </div>
        )}

        {matches && (
          <>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,gap:8}}>
              <input className="input input-sm" placeholder="Filter by team name..."
                value={filter} onChange={e => setFilter(e.target.value)}
                style={{flex:1,fontSize:'0.8rem'}} />
              <span className="text-muted text-sm" style={{flexShrink:0}}>{matches.length} total</span>
              <button className="btn btn-ghost btn-sm" onClick={selectAll} style={{flexShrink:0}}>Select all</button>
            </div>

            {matches.filter(m => !filter || m.name.toLowerCase().includes(filter.toLowerCase())).map(m => (
              <div key={m.sportmonksFixtureId}
                onClick={() => !m.alreadyAdded && toggleMatch(m.sportmonksFixtureId)}
                className="card mb-2"
                style={{
                  cursor: m.alreadyAdded ? 'default' : 'pointer',
                  opacity: m.alreadyAdded ? 0.5 : 1,
                  borderColor: selected.has(m.sportmonksFixtureId) ? 'var(--accent-primary)' : 'var(--border)',
                  display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
                }}>
                <input type="checkbox" readOnly
                  checked={selected.has(m.sportmonksFixtureId) || m.alreadyAdded} />
                <div style={{flex:1}}>
                  <div className="text-sm font-bold">{m.name}</div>
                  <div className="text-muted text-sm">
                    {m.startTime ? new Date(m.startTime).toLocaleDateString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : ''}
                    {' · '}{m.status}
                    {m.alreadyAdded && ' · Already added'}
                  </div>
                </div>
              </div>
            ))}

            <button className="btn btn-primary btn-full mt-4"
              onClick={importSelected} disabled={importing || selected.size === 0}>
              {importing ? 'Importing...' : `Import ${selected.size} fixture${selected.size !== 1 ? 's' : ''}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
