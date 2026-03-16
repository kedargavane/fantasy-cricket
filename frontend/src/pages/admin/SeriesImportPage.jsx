import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api.js';

// Known series for quick selection
const KNOWN_SERIES = [
  { id: 'feed2b38-dd1c-44ef-83a5-07d0ec6fdc3f', name: 'Legends League Cricket 2026', dates: 'Mar 11–27' },
  { id: '87c62aac-bc3c-4738-ab93-19da0690488f', name: 'Indian Premier League 2026',  dates: 'Mar 28–May 31' },
  { id: 'a9fd3945-9965-48f1-a1cf-2a64ce7fe2b3', name: 'Pakistan Super League 2026',  dates: 'Mar 26–May 3' },
  { id: '660b3bb0-f5ce-453d-835f-5456a1de1c5e', name: 'India tour of England 2026',  dates: 'Jul 1–19' },
  { id: '9eb1981f-88c4-4c53-8f7b-f71b1c760d69', name: 'T20 Blast 2026',              dates: 'May 22–Jul 18' },
  { id: 'ac5127e7-663b-4666-83ca-38f5d6935228', name: 'The Hundred Men\'s 2026',      dates: 'Jul 21–Aug 16' },
];

export default function SeriesImportPage() {
  const navigate = useNavigate();
  const [seriesId, setSeriesId]     = useState('');
  const [seasonId, setSeasonId]     = useState(1);
  const [matches, setMatches]       = useState(null);
  const [selected, setSelected]     = useState(new Set());
  const [loading, setLoading]       = useState(false);
  const [importing, setImporting]   = useState(false);
  const [result, setResult]         = useState(null);
  const [error, setError]           = useState('');

  async function preview() {
    if (!seriesId.trim()) return setError('Enter a series ID');
    setError(''); setMatches(null); setSelected(new Set()); setResult(null);
    setLoading(true);
    try {
      const res = await api.post('/admin/series/preview', { seriesId: seriesId.trim() });
      const ms = res.data.matches;
      setMatches(ms);
      // Auto-select upcoming + live matches that aren't already added
      const autoSelect = new Set(
        ms.filter(m => !m.alreadyAdded && !m.matchEnded).map(m => m.externalMatchId)
      );
      setSelected(autoSelect);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to fetch series');
    } finally { setLoading(false); }
  }

  async function importSelected() {
    if (selected.size === 0) return setError('Select at least one match');
    setError(''); setImporting(true);
    try {
      const res = await api.post('/admin/series/import', {
        seasonId,
        seriesId: seriesId.trim(),
        matchIds: Array.from(selected),
      });
      setResult(res.data);
      // Refresh match list to show updated alreadyAdded status
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

  function toggleAll() {
    const available = matches.filter(m => !m.alreadyAdded).map(m => m.externalMatchId);
    if (selected.size === available.length) setSelected(new Set());
    else setSelected(new Set(available));
  }

  const statusColor = m => m.matchEnded ? '#6b7280' : m.matchStarted ? '#22c55e' : '#60a5fa';
  const statusLabel = m => m.matchEnded ? 'Ended' : m.matchStarted ? 'Live' : 'Upcoming';

  return (
    <div style={{padding:'16px', maxWidth:600, margin:'0 auto', paddingBottom:80}}>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
        <button onClick={() => navigate('/admin')} style={{background:'none',border:'none',color:'var(--text-secondary)',fontSize:'1.5rem',cursor:'pointer',padding:0}}>‹</button>
        <h2 style={{fontSize:'1rem',fontWeight:700,margin:0}}>Import Series</h2>
      </div>

      {/* Quick select known series */}
      <div style={{marginBottom:16}}>
        <p style={{fontSize:'0.72rem',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:8}}>Quick Select</p>
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {KNOWN_SERIES.map(s => (
            <button key={s.id} onClick={() => setSeriesId(s.id)}
              style={{
                padding:'8px 12px', borderRadius:8, border:'1px solid var(--border)',
                background: seriesId === s.id ? 'rgba(0,229,255,0.1)' : 'var(--bg-surface)',
                borderColor: seriesId === s.id ? 'var(--accent-primary)' : 'var(--border)',
                color:'var(--text-primary)', cursor:'pointer', textAlign:'left',
                display:'flex', justifyContent:'space-between', alignItems:'center',
              }}>
              <span style={{fontSize:'0.8rem',fontWeight:500}}>{s.name}</span>
              <span style={{fontSize:'0.7rem',color:'var(--text-muted)'}}>{s.dates}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Manual series ID input */}
      <div style={{marginBottom:12}}>
        <p style={{fontSize:'0.72rem',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>Or enter series ID</p>
        <input
          value={seriesId} onChange={e => setSeriesId(e.target.value)}
          placeholder="e.g. 87c62aac-bc3c-4738-ab93-19da0690488f"
          style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--bg-elevated)',color:'var(--text-primary)',fontSize:'0.78rem',fontFamily:'var(--font-mono)'}}
        />
      </div>

      <div style={{display:'flex',gap:8,marginBottom:16,alignItems:'center'}}>
        <div style={{flex:1}}>
          <label style={{fontSize:'0.72rem',color:'var(--text-muted)'}}>Season ID</label>
          <input type="number" value={seasonId} onChange={e => setSeasonId(parseInt(e.target.value))}
            style={{width:'100%',padding:'6px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg-elevated)',color:'var(--text-primary)',fontSize:'0.8rem',marginTop:2}}
          />
        </div>
        <button onClick={preview} disabled={loading}
          style={{marginTop:18,padding:'8px 20px',borderRadius:8,background:'var(--accent-primary)',color:'#000',fontWeight:700,fontSize:'0.8rem',border:'none',cursor:'pointer',opacity:loading?0.6:1}}>
          {loading ? 'Loading...' : 'Preview'}
        </button>
      </div>

      {error && <div style={{color:'#f87171',fontSize:'0.8rem',marginBottom:12}}>{error}</div>}

      {result && (
        <div style={{background:'rgba(0,229,255,0.08)',border:'1px solid rgba(0,229,255,0.2)',borderRadius:8,padding:'10px 14px',marginBottom:12,fontSize:'0.8rem',color:'var(--accent-primary)'}}>
          ✓ {result.message} — {result.results?.filter(r=>r.status==='imported').map(r=>`${r.name.split(',')[0]} (${r.squadCount} players)`).join(', ')}
        </div>
      )}

      {matches && (
        <>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <p style={{fontSize:'0.72rem',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>
              {matches.length} matches · {selected.size} selected
            </p>
            <button onClick={toggleAll} style={{fontSize:'0.72rem',color:'var(--accent-primary)',background:'none',border:'none',cursor:'pointer'}}>
              {selected.size === matches.filter(m=>!m.alreadyAdded).length ? 'Deselect all' : 'Select all upcoming'}
            </button>
          </div>

          <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:16}}>
            {[...matches].sort((a,b) => new Date(a.startTime)-new Date(b.startTime)).map(m => (
              <div key={m.externalMatchId}
                onClick={() => !m.alreadyAdded && toggleMatch(m.externalMatchId)}
                style={{
                  display:'flex', alignItems:'center', gap:10,
                  padding:'10px 12px', borderRadius:8,
                  border:'1px solid var(--border)',
                  background: selected.has(m.externalMatchId) ? 'rgba(0,229,255,0.08)' : 'var(--bg-surface)',
                  borderColor: selected.has(m.externalMatchId) ? 'var(--accent-primary)' : m.alreadyAdded ? 'var(--border)' : 'var(--border)',
                  cursor: m.alreadyAdded ? 'default' : 'pointer',
                  opacity: m.alreadyAdded ? 0.5 : 1,
                }}>
                <input type="checkbox" checked={selected.has(m.externalMatchId) || m.alreadyAdded}
                  disabled={m.alreadyAdded} readOnly
                  style={{width:14,height:14,flexShrink:0,accentColor:'var(--accent-primary)'}}
                />
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:'0.8rem',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {m.teamA} vs {m.teamB}
                  </div>
                  <div style={{fontSize:'0.68rem',color:'var(--text-muted)',marginTop:1}}>
                    {new Date(m.startTime).toLocaleDateString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}
                    {m.venue ? ` · ${m.venue.split(',')[0]}` : ''}
                    {m.hasSquad ? ' · 👥' : ''}
                  </div>
                </div>
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:2,flexShrink:0}}>
                  <span style={{fontSize:'0.65rem',fontWeight:600,color:statusColor(m)}}>{statusLabel(m)}</span>
                  {m.alreadyAdded && <span style={{fontSize:'0.6rem',color:'var(--accent-green)'}}>✓ Added</span>}
                </div>
              </div>
            ))}
          </div>

          <button onClick={importSelected} disabled={importing || selected.size === 0}
            style={{width:'100%',padding:'12px',borderRadius:10,background:selected.size>0?'var(--accent-primary)':'var(--bg-elevated)',color:selected.size>0?'#000':'var(--text-muted)',fontWeight:700,fontSize:'0.875rem',border:'none',cursor:selected.size>0?'pointer':'default',opacity:importing?0.6:1}}>
            {importing ? 'Importing...' : `Import ${selected.size} match${selected.size!==1?'es':''}`}
          </button>
        </>
      )}
    </div>
  );
}
