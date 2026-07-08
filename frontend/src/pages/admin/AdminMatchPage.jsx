import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../utils/api.js';
import Spinner from '../../components/common/Spinner.jsx';
import './AdminPages.css';

const TABS = ['Details', 'Set Squad', 'Finalise'];

function matchTeamName(playerTeam, matchTeam) {
  if (!playerTeam || !matchTeam) return false;
  const p = playerTeam.toLowerCase().trim();
  const m = matchTeam.toLowerCase().trim();
  return p === m || p.includes(m) || m.includes(p);
}

export default function AdminMatchPage() {
  const { matchId } = useParams();
  const navigate    = useNavigate();
  const [match, setMatch]   = useState(null);
  const [squad, setSquad]   = useState([]);
  const [tab, setTab]       = useState(0);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg]       = useState({ type: '', text: '' });
  const [selectedXi, setSelectedXi] = useState(new Set());
  const [savingXi, setSavingXi]     = useState(false);

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
      const loadedSquad = sRes.data.squad || [];
      setSquad(loadedSquad);
      setSelectedXi(new Set(loadedSquad.filter(p => p.is_playing_xi).map(p => p.id)));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  function toggleXi(playerId) {
    setSelectedXi(prev => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }

  async function savePlayingXi() {
    const externalPlayerIds = squad
      .filter(p => selectedXi.has(p.id))
      .map(p => p.external_player_id)
      .filter(Boolean);

    setSavingXi(true);
    try {
      const res = await api.post(`/admin/matches/${matchId}/playing-xi`, { externalPlayerIds });
      flash('success', `Playing XI saved — ${res.data.updated} players confirmed`);
      const sRes = await api.get(`/matches/${matchId}/squad`);
      setSquad(sRes.data.squad || []);
    } catch (err) {
      flash('error', err.response?.data?.error || 'Failed to save Playing XI');
    } finally {
      setSavingXi(false);
    }
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

  async function cancelMatch() {
    if (!confirm('Are you sure? This will refund all entry units.')) return;
    try {
      const res = await api.post(`/admin/matches/${matchId}/cancel`);
      flash('success', `Match cancelled — ${res.data.refunded} teams refunded`);
      loadMatch();
    } catch (err) {
      console.error('[cancelMatch] error:', err.response?.status, err.response?.data, err.message);
      flash('error', err.response?.data?.error || err.message || 'Failed to cancel');
    }
  }

  if (loading) return <Spinner center />;
  if (!match)  return <div className="container mt-8 text-center">Match not found</div>;

  const xiPlayers     = squad.filter(p => p.is_playing_xi);
  const squadPlayers  = squad.filter(p => !p.is_playing_xi);

  // Group the full squad by team for the picker, using the same fuzzy match
  // as the team-builder page (Sportmonks/CricketData team labels can vary)
  let squadA = squad.filter(p => p.team === match.team_a);
  let squadB = squad.filter(p => p.team === match.team_b);
  if (squadA.length === 0 || squadB.length === 0) {
    squadA = squad.filter(p => matchTeamName(p.team, match.team_a));
    squadB = squad.filter(p => matchTeamName(p.team, match.team_b));
  }
  const selectedCountA = squadA.filter(p => selectedXi.has(p.id)).length;
  const selectedCountB = squadB.filter(p => selectedXi.has(p.id)).length;
  const xiChanged = selectedXi.size !== xiPlayers.length ||
    xiPlayers.some(p => !selectedXi.has(p.id));

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
            <div className="flex gap-2" style={{alignItems:'center', flexWrap:'wrap'}}>
              <button className="btn btn-secondary btn-sm" onClick={syncSquad}>
                ↻ Sync from Sportmonks
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={savePlayingXi}
                disabled={savingXi || !xiChanged || squad.length === 0}
              >
                {savingXi ? 'Saving…' : 'Save Playing XI'}
              </button>
              {xiChanged && (
                <span className="text-sm" style={{color:'var(--accent-gold)'}}>Unsaved changes</span>
              )}
            </div>

            {squad.length === 0 ? (
              <div className="card text-center text-secondary">
                No squad loaded. Click "Sync from Sportmonks" to fetch.
              </div>
            ) : (
              <div className="admin-xi-columns" style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
                <SquadColumn
                  teamName={match.team_a}
                  players={squadA}
                  selectedCount={selectedCountA}
                  selectedXi={selectedXi}
                  onToggle={toggleXi}
                />
                <SquadColumn
                  teamName={match.team_b}
                  players={squadB}
                  selectedCount={selectedCountB}
                  selectedXi={selectedXi}
                  onToggle={toggleXi}
                />
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

            <div className="flex-col gap-3">
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
                <>
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
                </>
              )}
              {match.status !== 'cancelled' && (
                <button
                  className="btn btn-danger btn-full"
                  onClick={cancelMatch}
                >
                  Cancel Match (refund all)
                </button>
              )}
            </div>
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

function SquadColumn({ teamName, players, selectedCount, selectedXi, onToggle }) {
  return (
    <div className="flex-col gap-2">
      <p className="admin-list-label">
        {teamName} — <span className={selectedCount === 11 ? 'text-green' : 'text-secondary'}>{selectedCount}/11</span>
      </p>
      {players.length === 0 && (
        <div className="card text-center text-secondary text-sm">No players synced for this team</div>
      )}
      {players.map(p => {
        const checked = selectedXi.has(p.id);
        return (
          <div
            key={p.id}
            className="admin-player-row card mb-1"
            style={{cursor:'pointer'}}
            onClick={() => onToggle(p.id)}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(p.id)}
              onClick={e => e.stopPropagation()}
              style={{marginRight:8}}
            />
            <div className="flex-col flex-1">
              <span className={`text-sm ${checked ? 'font-bold' : ''}`}>{p.name}</span>
              <span className="text-muted text-sm">{p.role || 'unknown'}</span>
            </div>
            <span className={`badge ${checked ? 'badge-green' : 'badge-muted'}`}>
              {checked ? 'XI' : 'Squad'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
