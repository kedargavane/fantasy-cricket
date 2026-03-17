import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../utils/api.js';
import Spinner from '../../components/common/Spinner.jsx';
import './AdminPages.css';

const TABS = ['Details', 'Set Squad', 'Finalise'];

export default function AdminMatchPage() {
  const { matchId } = useParams();
  const navigate    = useNavigate();
  const [match, setMatch]   = useState(null);
  const [squad, setSquad]   = useState([]);
  const [tab, setTab]       = useState(0);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg]       = useState({ type: '', text: '' });

  useEffect(() => { loadMatch(); }, [matchId]);

  async function loadMatch() {
    try {
      const [mRes, sRes] = await Promise.all([
        api.get(`/admin/matches?seasonId=0`).catch(() => ({ data: { matches: [] } })),
        api.get(`/matches/${matchId}/squad`),
      ]);
      // Find this match from the admin list or match detail
      const matchRes = await api.get(`/matches/${matchId}`);
      setMatch(matchRes.data.match);
      setSquad(sRes.data.squad || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  function flash(type, text) {
    setMsg({ type, text });
    setTimeout(() => setMsg({ type: '', text: '' }), 4000);
  }

  async function syncSquad() {
    try {
      const res = await api.post(`/admin/matches/${matchId}/sync-squad`);
      flash('success', `Synced ${res.data.synced} players from Sportmonks`);
      const sRes = await api.get(`/matches/${matchId}/squad`);
      setSquad(sRes.data.squad || []);
    } catch (err) {
      flash('error', err.response?.data?.error || 'Sync failed');
    }
  }

  async function finalise() {
    if (!confirm('Finalise this match? This will lock scores and distribute prizes.')) return;
    try {
      await api.post(`/admin/matches/${matchId}/finalise`);
      flash('success', 'Match finalised and prizes distributed');
      loadMatch();
    } catch (err) {
      flash('error', err.response?.data?.error || 'Finalisation failed');
    }
  }

  async function voidMatch() {
    if (!confirm('Void this match? No prizes will be distributed.')) return;
    try {
      await api.post(`/admin/matches/${matchId}/void`);
      flash('success', 'Match voided');
      loadMatch();
    } catch (err) {
      flash('error', err.response?.data?.error || 'Failed to void');
    }
  }

  if (loading) return <Spinner center />;
  if (!match)  return <div className="container mt-8 text-center">Match not found</div>;

  const xiPlayers     = squad.filter(p => p.is_playing_xi);
  const squadPlayers  = squad.filter(p => !p.is_playing_xi);

  return (
    <div className="page admin-page">
      <div className="admin-header">
        <button className="btn-back" onClick={() => navigate('/admin')}>‹</button>
        <div>
          <h2 className="text-base font-bold">{match.team_a} vs {match.team_b}</h2>
          <span className={`badge badge-${match.status === 'live' ? 'green' : match.status === 'completed' ? 'muted' : 'cyan'}`}>
            {match.status}
          </span>
        </div>
      </div>

      {msg.text && (
        <div className={`container mt-3`}>
          <div className={`settings-msg ${msg.type}`}>{msg.text}</div>
        </div>
      )}

      <div className="container mt-4">
        <div className="tabs mb-4">
          {TABS.map((t, i) => (
            <button key={t} className={`tab ${tab === i ? 'active' : ''}`} onClick={() => setTab(i)}>{t}</button>
          ))}
        </div>

        {/* ── TAB 0: Details ── */}
        {tab === 0 && (
          <div className="flex-col gap-4">
            <div className="card">
              {[
                ['Sportmonks Fixture ID', match.sportmonks_fixture_id || match.external_match_id],
                ['Type', match.match_type?.toUpperCase()],
                ['Venue', match.venue || '—'],
                ['Start Time', new Date(match.start_time).toLocaleString('en-IN')],
                ['Entry Units', match.entry_units || 300],
                ['Status', match.status],
              ].map(([label, value]) => (
                <div key={label} className="settings-field">
                  <span className="text-secondary text-sm">{label}</span>
                  <span className="mono text-sm">{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TAB 1: Set Squad ── */}
        {tab === 1 && (
          <div className="flex-col gap-4">
            <div className="flex gap-2">
              <button className="btn btn-secondary btn-sm" onClick={syncSquad}>
                ↻ Sync from Sportmonks
              </button>
              <span className="text-muted text-sm" style={{alignSelf:'center'}}>
                {xiPlayers.length}/12 Playing XI set
              </span>
            </div>

            {xiPlayers.length > 0 && (
              <>
                <p className="admin-list-label">Playing XI ({xiPlayers.length})</p>
                {xiPlayers.map(p => (
                  <div key={p.id} className="admin-player-row card mb-1">
                    <div className="flex-col flex-1">
                      <span className="text-sm font-bold">{p.name}</span>
                      <span className="text-muted text-sm">{p.team} · {p.role || 'unknown'}</span>
                    </div>
                    <span className="badge badge-green">XI</span>
                  </div>
                ))}
              </>
            )}

            {squadPlayers.length > 0 && (
              <>
                <p className="admin-list-label mt-2">Squad — not confirmed ({squadPlayers.length})</p>
                {squadPlayers.map(p => (
                  <div key={p.id} className="admin-player-row card mb-1">
                    <div className="flex-col flex-1">
                      <span className="text-sm">{p.name}</span>
                      <span className="text-muted text-sm">{p.team}</span>
                    </div>
                    <span className="badge badge-muted">Squad</span>
                  </div>
                ))}
              </>
            )}

            {squad.length === 0 && (
              <div className="card text-center text-secondary">
                No squad loaded. Click "Sync from Sportmonks" to fetch.
              </div>
            )}
          </div>
        )}

        {/* ── TAB 2: Finalise ── */}
        {tab === 2 && (
          <div className="flex-col gap-4">
            {/* Pre-flight checklist */}
            <div className="card">
              <h3 className="text-sm font-bold mb-4" style={{color:'var(--accent-primary)'}}>Pre-flight Checks</h3>
              <CheckItem
                ok={match.status !== 'upcoming'}
                label="Match has started"
              />
              <CheckItem
                ok={xiPlayers.length >= 11}
                label={`Playing XI set (${xiPlayers.length}/11 minimum)`}
              />
              <CheckItem
                ok={match.status !== 'abandoned'}
                label="Match not voided"
              />
            </div>

            {match.status === 'completed' ? (
              <div className="card text-center">
                <span style={{fontSize:'2rem'}}>✅</span>
                <p className="mt-2 text-green font-bold">Match finalised</p>
                <button
                  className="btn btn-secondary btn-sm mt-4"
                  onClick={() => navigate(`/match/${matchId}/result`)}
                >
                  View Result
                </button>
              </div>
            ) : (
              <div className="flex-col gap-3">
                <button
                  className="btn btn-gold btn-full"
                  onClick={finalise}
                  disabled={match.status === 'upcoming' || xiPlayers.length < 11}
                >
                  🏆 Finalise Match & Distribute Prizes
                </button>
                <button
                  className="btn btn-danger btn-full"
                  onClick={voidMatch}
                >
                  Void Match (no prizes)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CheckItem({ ok, label }) {
  return (
    <div className="check-item">
      <span className={ok ? 'text-green' : 'text-red'}>{ok ? '✓' : '✗'}</span>
      <span className={`text-sm ${ok ? '' : 'text-secondary'}`}>{label}</span>
    </div>
  );
}
