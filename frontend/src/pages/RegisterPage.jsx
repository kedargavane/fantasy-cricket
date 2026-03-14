import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import './AuthPages.css';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate     = useNavigate();
  const [params]     = useSearchParams();

  const [form, setForm] = useState({
    name: '', email: '', password: '',
    inviteCode: params.get('code') || '',
  });
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const handle = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const submit = async e => {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) {
      return setError('Password must be at least 8 characters');
    }
    setLoading(true);
    try {
      await register(form.name, form.email, form.password, form.inviteCode.toUpperCase());
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-bg-glow" />

      <div className="auth-container fade-up">
        <div className="auth-logo">
          <span className="auth-logo-icon">🏏</span>
          <h1 className="auth-brand">GYARAH<br />SAPNE</h1>
        </div>

        <div className="auth-card">
          <h2 className="auth-title">Join the league</h2>
          <p className="auth-subtitle">You'll need an invite code from your admin</p>

          <form onSubmit={submit} className="auth-form">
            <div className="input-group">
              <label className="input-label">Your Name</label>
              <input
                className="input"
                type="text"
                name="name"
                value={form.name}
                onChange={handle}
                placeholder="Virat Kohli"
                required
                autoComplete="name"
              />
            </div>

            <div className="input-group">
              <label className="input-label">Email</label>
              <input
                className="input"
                type="email"
                name="email"
                value={form.email}
                onChange={handle}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>

            <div className="input-group">
              <label className="input-label">Password</label>
              <input
                className="input"
                type="password"
                name="password"
                value={form.password}
                onChange={handle}
                placeholder="Min 8 characters"
                required
                autoComplete="new-password"
              />
            </div>

            <div className="input-group">
              <label className="input-label">Invite Code</label>
              <input
                className="input invite-code-input"
                type="text"
                name="inviteCode"
                value={form.inviteCode}
                onChange={handle}
                placeholder="XXXXXXXX"
                required
                maxLength={8}
                style={{ textTransform: 'uppercase', letterSpacing: '0.2em', fontFamily: 'var(--font-mono)' }}
              />
            </div>

            {error && <p className="auth-error">{error}</p>}

            <button
              type="submit"
              className="btn btn-primary btn-full"
              disabled={loading}
            >
              {loading ? <span className="spinner" style={{width:18,height:18,borderWidth:2}} /> : 'Create Account'}
            </button>
          </form>

          <p className="auth-footer">
            Already have an account?{' '}
            <Link to="/login" className="auth-link">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
