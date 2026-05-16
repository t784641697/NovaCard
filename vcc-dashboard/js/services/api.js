// ══════════════════════════════════════════════
//  API 服务
// ══════════════════════════════════════════════
import { _token, API_BASE, clearAuth } from '../utils/config.js';
import { showToast } from '../components/ui/toast.js';

export async function apiFetch(path, opts = {}) {
  try {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (_token) headers['Authorization'] = 'Bearer ' + _token;

    // 添加超时控制（60秒）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const res = await fetch(API_BASE + path, { ...opts, headers, signal: controller.signal });
    clearTimeout(timeoutId);

    // 检查HTTP状态码
    if (res.status === 429) {
      return { code: 429, msg: '请求过于频繁，请稍后再试' };
    }

    if (!res.ok && res.status !== 200 && res.status !== 304) {
      let errorMsg = `HTTP ${res.status}`;
      try {
        const errorData = await res.json();
        errorMsg = errorData.msg || errorMsg;
      } catch (e) {
        // 无法解析JSON响应
      }
      return { code: res.status, msg: errorMsg };
    }

    const json = await res.json();

    if (res.status === 401) {
      clearAuth();
      window.showAuth && window.showAuth();
      throw new Error('Unauthorized');
    }

    return json;
  } catch (err) {
    let errorMsg;
    if (err.name === 'AbortError') {
      errorMsg = '请求超时，请检查网络连接或刷新重试';
    } else if (err.name === 'TypeError') {
      errorMsg = '网络连接失败，请检查网络';
    } else if (err.message === 'Unauthorized') {
      throw err;
    } else {
      errorMsg = `请求失败: ${err.message}`;
    }

    return {
      code: -1,
      msg: errorMsg
    };
  }
}

// 便捷的API方法
export const api = {
  get: (path) => apiFetch(path, { method: 'GET' }),
  post: (path, data) => apiFetch(path, { method: 'POST', body: JSON.stringify(data) }),
  put: (path, data) => apiFetch(path, { method: 'PUT', body: JSON.stringify(data) }),
  del: (path) => apiFetch(path, { method: 'DELETE' })
};
