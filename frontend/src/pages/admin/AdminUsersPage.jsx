import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../utils/api.js';
import Spinner from '../../components/common/Spinner.jsx';
import './AdminPages.css';

export default function AdminUsersPage() {
  const { activeSeason } = useAuth();
  const [users, setUsers]   = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg]       = useState({ type: '', text: '' });

  useEffect(() => {
    if (activeSeason) loadUsers();
  }, [activeSeason]);

  async function loadUsers(q = '') {
    setLoading(true);
    try {
      const params = new URLSearchParams({ seasonId: activeSeason.id });
      if (q) params.set('search', q);
      const res = await api.get(`/admin/users?${params}`);
      setUsers(res.data.users || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  function flash(type, text) {
    setMsg({ type, text });
    setTimeout(() => setMsg({ type: '', text: '' }), 3000);
  }

  async function resetPassword(userId, name) {
    const pw = prompt(`Set new password for ${name}:`);
    if (!pw || pw.length < 8) return alert('Password must be at least 8 characters');
    try {
      await api.post(`/admin/users/${userId}/reset-password`, { newPassword: pw });
      flash('success', `Password reset for ${name}`);
    } catch (err) {
      flash('error', err.response?.data?.error || 'Failed to reset password');
    }
  }

  function handleSearch(e) {
    setSearch(e.target.value);
    loadUsers(e.target.value);
  }

  if (loading) return <Spinner center />;

  return (
    <div className="page admin-page">
      <div className="container">
        <header className="admin-header fade-up">
          <h1 className="admin-title">Users</h1>
          <span className="badge badge-cyan">{users.length} members</span>
        </header>

        {msg.text && (
          <div className={`settings-msg ${msg.type} mb-4`}>{msg.text}</div>
        )}

        <div className="input-group mb-4 fade-up">
          <input
            className="input"
            placeholder="Search by name or email..."
            value={search}
            onChange={handleSearch}
          />
        </div>

        <div className="fade-up">
          {users.map(u => (
            <div key={u.id} className="card mb-2">
              <div className="flex items-center justify-between">
                <div className="flex-col gap-1 flex-1 min-width-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm">{u.name}</span>
                    {u.is_admin ? <span className="badge badge-purple">Admin</span> : null}
                  </div>
                  <span className="text-muted text-sm">{u.email}</span>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => resetPassword(u.id, u.name)}
                >
                  Reset PW
                </button>
              </div>

              {/* Season stats */}
              {u.matches_played > 0 && (
                <div className="user-stats mt-3">
                  <div className="user-stat">
                    <span className="mono">{u.matches_played}</span>
                    <span className="text-muted" style={{fontSize:'0.7rem'}}>Played</span>
                  </div>
                  <div className="user-stat">
                    <span className={`mono ${u.net_units >= 0 ? 'text-green' : 'text-red'}`}>
                      {u.net_units >= 0 ? '+' : ''}{u.net_units}
                    </span>
                    <span className="text-muted" style={{fontSize:'0.7rem'}}>Net</span>
                  </div>
                  <div className="user-stat">
                    <span className="mono text-gold">{u.top_finishes}</span>
                    <span className="text-muted" style={{fontSize:'0.7rem'}}>Top Finishes</span>
                  </div>
                </div>
              )}
            </div>
          ))}

          {users.length === 0 && (
            <div className="card text-center text-secondary">No users found</div>
          )}
        </div>

        {/* Invite card */}
        {activeSeason && (
          <div className="invite-card card mt-6 fade-up">
            <p className="text-sm text-secondary mb-2">Share this code to invite players:</p>
            <div className="invite-code-display">
              <span className="mono" style={{fontSize:'1.5rem', letterSpacing:'0.2em'}}>
                {activeSeason.invite_code}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  navigator.clipboard.writeText(activeSeason.invite_code);
                }}
              >
                Copy
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
