import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

export const SOCKET_URL = import.meta.env.VITE_API_URL || '';

const api = axios.create({
  baseURL: BASE_URL,
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
