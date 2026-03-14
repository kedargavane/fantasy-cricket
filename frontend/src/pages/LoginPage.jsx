import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import './AuthPages.css';

export default function LoginPage() {
  const { login }   = useAuth();
  const navigate    = useNavigate();
  const [form, setForm]   = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handle = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const submit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form.email, form.password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
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
          <h2 className="auth-title">Welcome back</h2>
          <p className="auth-subtitle">Sign in to your league</p>

          <form onSubmit={submit} className="auth-form">
            <div className="input-group">
              <label className="input-label">Email</label>
              <input
                className={`input ${error ? 'error' : ''}`}
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
                className={`input ${error ? 'error' : ''}`}
                type="password"
                name="password"
                value={form.password}
                onChange={handle}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            {error && <p className="auth-error">{error}</p>}

            <button
              type="submit"
              className="btn btn-primary btn-full"
              disabled={loading}
            >
              {loading ? <span className="spinner" style={{width:18,height:18,borderWidth:2}} /> : 'Sign In'}
            </button>
          </form>

          <p className="auth-footer">
            New to the league?{' '}
            <Link to="/register" className="auth-link">Join with invite code</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
