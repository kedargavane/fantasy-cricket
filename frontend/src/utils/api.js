import axios from 'axios';

// Always use /api — server.cjs proxies it to the backend in production
// Vite proxies it in development
const api = axios.create({
  baseURL: '/api',
  timeout: 12000,
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem('fc_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('fc_token');
      localStorage.removeItem('fc_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
export const SOCKET_URL = '';
