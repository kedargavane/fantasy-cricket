import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../utils/api.js';
import './SettingsPage.css';

export default function SettingsPage() {
  const { user, logout, fetchMe } = useAuth();
  const navigate = useNavigate();
  const [name, setName]           = useState(user?.name || '');
  const [pwForm, setPwForm]       = useState({ current: '', next: '', confirm: '' });
  const [msg, setMsg]             = useState({ type: '', text: '' });
  const [saving, setSaving]       = useState(false);

  function flash(type, text) {
    setMsg({ type, text });
    setTimeout(() => setMsg({ type: '', text: '' }), 3000);
  }

  async function saveName(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/auth/update-profile', { name });
      await fetchMe();
      flash('success', 'Name updated');
    } catch (err) {
      flash('error', err.response?.data?.error || 'Failed to update');
    } finally { setSaving(false); }
  }

  async function changePassword(e) {
    e.preventDefault();
    if (pwForm.next !== pwForm.confirm) return flash('error', 'Passwords do not match');
    if (pwForm.next.length < 8) return flash('error', 'Password must be at least 8 characters');
    setSaving(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: pwForm.current,
        newPassword: pwForm.next,
      });
      setPwForm({ current: '', next: '', confirm: '' });
      flash('success', 'Password changed');
    } catch (err) {
      flash('error', err.response?.data?.error || 'Failed to change password');
    } finally { setSaving(false); }
  }

  async function subscribePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return flash('error', 'Push notifications not supported on this device');
    }
    try {
      const { data: { publicKey } } = await api.get('/push/vapid-public-key');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await api.post('/push/subscribe', {
        endpoint: sub.endpoint,
        keys: { p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')))), auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')))) },
        userAgent: navigator.userAgent,
      });
      flash('success', 'Push notifications enabled');
    } catch (err) {
      flash('error', 'Could not enable notifications: ' + err.message);
    }
  }

  return (
    <div className="page settings-page">
      <div className="container">

        <h1 className="settings-title fade-up">Settings</h1>

        {msg.text && (
          <div className={`settings-msg ${msg.type} fade-up`}>{msg.text}</div>
        )}

        {/* Account */}
        <section className="settings-section fade-up">
          <h2 className="settings-section-title">Account</h2>
          <div className="card">
            <div className="settings-field">
              <span className="settings-field-label">Email</span>
              <span className="settings-field-value text-secondary">{user?.email}</span>
            </div>
            <div className="divider" />
            <form onSubmit={saveName} className="settings-inline-form">
              <div className="input-group" style={{flex:1}}>
                <label className="input-label">Display Name</label>
                <input
                  className="input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your name"
                  required
                />
              </div>
              <button type="submit" className="btn btn-secondary btn-sm" disabled={saving || name === user?.name}>
                Save
              </button>
            </form>
          </div>
        </section>

        {/* Password */}
        <section className="settings-section fade-up">
          <h2 className="settings-section-title">Change Password</h2>
          <div className="card">
            <form onSubmit={changePassword} className="flex-col gap-4">
              <div className="input-group">
                <label className="input-label">Current Password</label>
                <input
                  className="input" type="password"
                  value={pwForm.current}
                  onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
                  required autoComplete="current-password"
                />
              </div>
              <div className="input-group">
                <label className="input-label">New Password</label>
                <input
                  className="input" type="password"
                  value={pwForm.next}
                  onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))}
                  required autoComplete="new-password" minLength={8}
                  placeholder="Min 8 characters"
                />
              </div>
              <div className="input-group">
                <label className="input-label">Confirm New Password</label>
                <input
                  className="input" type="password"
                  value={pwForm.confirm}
                  onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                  required autoComplete="new-password"
                />
              </div>
              <button type="submit" className="btn btn-secondary" disabled={saving}>
                Update Password
              </button>
            </form>
          </div>
        </section>

        {/* Notifications */}
        <section className="settings-section fade-up">
          <h2 className="settings-section-title">Notifications</h2>
          <div className="card">
            <p className="text-secondary text-sm mb-4">
              Get notified 1 hour before a match, and when results are in.
              {' '}On iOS, add this app to your Home Screen first.
            </p>
            <button className="btn btn-secondary btn-full" onClick={subscribePush}>
              Enable Push Notifications
            </button>
          </div>
        </section>

        {/* Sign out */}
        <section className="settings-section fade-up">
          <h2 className="settings-section-title">Help</h2>
          <div className="card">
            <button className="btn btn-secondary btn-full" onClick={() => navigate('/faq')}>
              How it works — scoring, backups & rules
            </button>
          </div>
        </section>

        <section className="settings-section fade-up">
          <button className="btn btn-danger btn-full" onClick={logout}>
            Sign Out
          </button>
        </section>

      </div>
    </div>
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}
