import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]           = useState(null);
  const [seasons, setSeasons]     = useState([]);
  const [activeSeason, setActiveSeason] = useState(null);
  const [loading, setLoading]     = useState(true);

  // Restore session on mount
  useEffect(() => {
    const token = localStorage.getItem('fc_token');
    const saved = localStorage.getItem('fc_user');
    if (token && saved) {
      setUser(JSON.parse(saved));
      fetchMe();
    } else {
      setLoading(false);
    }
  }, []);

  const fetchMe = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
      setSeasons(data.seasons || []);
      localStorage.setItem('fc_user', JSON.stringify(data.user));

      // Restore or default active season — prefer saved, then latest (highest ID)
      const savedSeasonId = localStorage.getItem('fc_season');
      const allSeasons = data.seasons || [];
      const latest = allSeasons.reduce((a, b) => (b.id > a.id ? b : a), allSeasons[0] || null);
      const found = allSeasons.find(s => s.id === parseInt(savedSeasonId)) || latest;
      if (found) setActiveSeason(found);
    } catch {
      // Token invalid — clear
      logout();
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('fc_token', data.token);
    localStorage.setItem('fc_user', JSON.stringify(data.user));
    setUser(data.user);
    await fetchMe();
    return data;
  }, [fetchMe]);

  const register = useCallback(async (name, email, password, inviteCode) => {
    const { data } = await api.post('/auth/register', { name, email, password, inviteCode });
    localStorage.setItem('fc_token', data.token);
    localStorage.setItem('fc_user', JSON.stringify(data.user));
    setUser(data.user);
    await fetchMe();
    return data;
  }, [fetchMe]);

  const logout = useCallback(() => {
    localStorage.removeItem('fc_token');
    localStorage.removeItem('fc_user');
    localStorage.removeItem('fc_season');
    setUser(null);
    setSeasons([]);
    setActiveSeason(null);
  }, []);

  const switchSeason = useCallback((season) => {
    setActiveSeason(season);
    localStorage.setItem('fc_season', season.id);
  }, []);

  return (
    <AuthContext.Provider value={{
      user, seasons, activeSeason,
      loading, login, register, logout,
      switchSeason, fetchMe,
      isAdmin: user?.isAdmin === true,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
