import axios, { AxiosError } from 'axios';

export const api = axios.create({
  baseURL: 'http://localhost:3000',
  timeout: 120_000,
});

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      const data = error.response?.data;
      const message =
        typeof data === 'string'
          ? data
          : typeof (data as { message?: unknown } | undefined)?.message === 'string'
            ? ((data as { message?: string }).message ?? 'Request failed')
            : error.message;

      return Promise.reject(
        new Error(status ? `${message} (HTTP ${status})` : message),
      );
    }
    return Promise.reject(error);
  },
);

