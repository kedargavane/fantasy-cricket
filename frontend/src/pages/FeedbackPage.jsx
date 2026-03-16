import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../utils/api.js';
import Spinner from '../components/common/Spinner.jsx';
import './FeedbackPage.css';

const TYPE_CONFIG = {
  bug:     { label: '🐛 Bug report',       color: 'fb-type-bug'  },
  feature: { label: '✨ Feature request',  color: 'fb-type-feat' },
  ux:      { label: '🎨 UI improvement',   color: 'fb-type-ux'   },
  general: { label: '💬 General feedback', color: 'fb-type-gen'  },
};

const STATUS_CONFIG = {
  open:        { label: 'Open',        color: 'fb-status-open' },
  in_progress: { label: 'In progress', color: 'fb-status-prog' },
  resolved:    { label: 'Resolved',    color: 'fb-status-done' },
};

export default function FeedbackPage() {
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();

  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg]           = useState('');
  const [filter, setFilter]     = useState('all');
  const [editId, setEditId]     = useState(null);

  const [form, setForm] = useState({ type: 'feature', title: '', details: '' });
  const [adminEdit, setAdminEdit] = useState({ status: '', resolution: '' });

  useEffect(() => { loadFeedback(); }, []);

  async function loadFeedback() {
    try {
      const res = await api.get('/feedback');
      setItems(res.data.feedback || []);
    } catch {}
    finally { setLoading(false); }
  }

  async function submitFeedback(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSubmitting(true);
    try {
      await api.post('/feedback', form);
      setForm({ type: 'feature', title: '', details: '' });
      setMsg('Submitted! Thanks for your feedback.');
      setTimeout(() => setMsg(''), 3000);
      loadFeedback();
    } catch { setMsg('Failed to submit. Try again.'); }
    finally { setSubmitting(false); }
  }

  async function saveAdminEdit(id) {
    try {
      await api.patch(`/feedback/${id}`, adminEdit);
      setEditId(null);
      setAdminEdit({ status: '', resolution: '' });
      loadFeedback();
    } catch {}
  }

  async function deleteFeedback(id) {
    if (!confirm('Delete this item?')) return;
    await api.delete(`/feedback/${id}`);
    loadFeedback();
  }

  const filtered = items.filter(i => filter === 'all' || i.status === filter);

  return (
    <div className="fb-page">
      <div className="fb-header">
        <button className="fb-back" onClick={() => navigate(-1)}>‹</button>
        <span className="fb-title">Feedback & Requests</span>
      </div>

      <div className="fb-body">

        {/* Submit form */}
        <div className="fb-card">
          <div className="fb-card-title">Submit a request</div>
          <form onSubmit={submitFeedback}>
            <div className="fb-field">
              <label className="fb-label">Type</label>
              <select className="fb-select" value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
                {Object.entries(TYPE_CONFIG).map(([k,v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div className="fb-field">
              <label className="fb-label">Title</label>
              <input className="fb-input" placeholder="Short description..."
                value={form.title} onChange={e => setForm({...form, title: e.target.value})} required />
            </div>
            <div className="fb-field">
              <label className="fb-label">Details</label>
              <textarea className="fb-textarea" placeholder="Tell us more — what happened, what did you expect, any other context..."
                value={form.details} onChange={e => setForm({...form, details: e.target.value})} />
            </div>
            {msg && <div className={`fb-msg ${msg.includes('Failed') ? 'fb-msg-err' : 'fb-msg-ok'}`}>{msg}</div>}
            <button type="submit" className="fb-submit" disabled={submitting || !form.title.trim()}>
              {submitting ? 'Submitting...' : 'Submit'}
            </button>
          </form>
        </div>

        {/* Filter tabs */}
        <div className="fb-filters">
          {['all', 'open', 'in_progress', 'resolved'].map(f => (
            <button key={f} className={`fb-filter-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? `All (${items.length})` : f === 'in_progress' ? 'In progress' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Items list */}
        {loading ? <Spinner center /> : filtered.length === 0 ? (
          <div className="fb-empty">No items yet</div>
        ) : filtered.map(item => (
          <div key={item.id} className="fb-item">
            <div className="fb-item-top">
              <span className={`fb-type ${TYPE_CONFIG[item.type]?.color}`}>
                {TYPE_CONFIG[item.type]?.label || item.type}
              </span>
              <span className={`fb-status ${STATUS_CONFIG[item.status]?.color}`}>
                {STATUS_CONFIG[item.status]?.label || item.status}
              </span>
            </div>
            <div className="fb-item-title">{item.title}</div>
            {item.details ? <div className="fb-item-details">{item.details}</div> : null}
            <div className="fb-item-meta">{item.user_name} · {new Date(item.created_at).toLocaleDateString('en-IN', {day:'numeric',month:'short'})}</div>
            {item.resolution ? (
              <div className="fb-resolution">✓ {item.resolution}</div>
            ) : null}

            {/* Admin controls */}
            {isAdmin && (
              editId === item.id ? (
                <div className="fb-admin-edit">
                  <select className="fb-select" value={adminEdit.status} onChange={e => setAdminEdit({...adminEdit, status: e.target.value})}>
                    <option value="">-- Status --</option>
                    {Object.entries(STATUS_CONFIG).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <textarea className="fb-textarea" placeholder="Resolution note..."
                    value={adminEdit.resolution} onChange={e => setAdminEdit({...adminEdit, resolution: e.target.value})} />
                  <div style={{display:'flex',gap:8,marginTop:6}}>
                    <button className="fb-btn-save" onClick={() => saveAdminEdit(item.id)}>Save</button>
                    <button className="fb-btn-cancel" onClick={() => setEditId(null)}>Cancel</button>
                    <button className="fb-btn-delete" onClick={() => deleteFeedback(item.id)}>Delete</button>
                  </div>
                </div>
              ) : (
                <button className="fb-admin-btn" onClick={() => {
                  setEditId(item.id);
                  setAdminEdit({ status: item.status, resolution: item.resolution });
                }}>Edit</button>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
