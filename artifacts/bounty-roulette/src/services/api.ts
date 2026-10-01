import { getTelegramWebApp } from '../hooks/useTelegramWebApp';
import { getLang } from '../i18n';
import { isPreviewMode, previewGet, TelegramOnlyError } from './preview';

const API_BASE = '/api';

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Opened as a website (outside Telegram): show sample data, block every action.
  if (isPreviewMode()) {
    if ((options.method ?? 'GET') === 'GET') return (await previewGet(path)) as T;
    const err = new TelegramOnlyError();
    throw new ApiError(err.message, err.code, err.status);
  }
  const initData = getTelegramWebApp()?.initData ?? '';

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': initData,
      'X-Lang': getLang(),
      ...(options.headers || {}),
    },
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok || body.ok === false) {
    throw new ApiError(body.message || 'Request failed', body.code || 'UNKNOWN', res.status);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /** Multipart POST with several fields/files (exchange posts and reports). */
  form: async <T>(path: string, form: FormData): Promise<T> => {
    if (isPreviewMode()) {
      const err = new TelegramOnlyError();
      throw new ApiError(err.message, err.code, err.status);
    }
    const initData = getTelegramWebApp()?.initData ?? '';
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'X-Telegram-Init-Data': initData, 'X-Lang': getLang() },
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      throw new ApiError(body.message || 'Upload failed', body.code || 'UNKNOWN', res.status);
    }
    return body as T;
  },
  upload: async <T>(path: string, file: File, fieldName = 'image'): Promise<T> => {
    const initData = getTelegramWebApp()?.initData ?? '';
    const form = new FormData();
    form.append(fieldName, file);
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'X-Telegram-Init-Data': initData }, // no Content-Type — the browser sets the multipart boundary itself
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      throw new ApiError(body.message || 'Upload failed', body.code || 'UNKNOWN', res.status);
    }
    return body as T;
  },
};
