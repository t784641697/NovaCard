// v1.0.24 管理员卡段业务配置 service
// 持久化管理员在"卡段管理"页面的设置（available / applicable_platforms / custom_message）
// 优先级：DB override > HARDCODED > docx metadata > upstream
// 注意：PM2 cluster mode 多 worker 进程，进程内 cache 会导致状态不一致。
//       17 行数据 + 每次 /meta/products 都查 = 可忽略性能影响，去掉 cache。

const db = require('../db/database');

function loadAll() {
  try {
    const rows = db.prepare('SELECT product_code, available, applicable_platforms, custom_message, updated_at, updated_by FROM card_product_overrides').all();
    const map = new Map();
    for (const r of rows) {
      let platforms = null;
      if (r.applicable_platforms) {
        try {
          platforms = JSON.parse(r.applicable_platforms);
          if (!Array.isArray(platforms)) platforms = null;
        } catch { platforms = null; }
      }
      map.set(r.product_code, {
        product_code:         r.product_code,
        available:            r.available === 1,
        applicable_platforms: platforms,
        custom_message:       r.custom_message,
        updated_at:           r.updated_at,
        updated_by:           r.updated_by,
      });
    }
    return map;
  } catch (e) {
    return new Map();
  }
}

// 保留 invalidate / _cache 字段避免外部调用崩溃，但已无实际作用
function invalidate() { /* no-op: 每次都直查 DB 保证多 worker 一致 */ }

/**
 * 获取单个卡段的 override（无则返回 null）
 * @param {string} productCode
 * @returns {OverrideRecord|null}
 */
function get(productCode) {
  if (!productCode) return null;
  return loadAll().get(productCode) || null;
}

/**
 * 获取所有卡段的 override（数组）
 * @returns {OverrideRecord[]}
 */
function listAll() {
  return Array.from(loadAll().values());
}

/**
 * 列出所有 17 个卡段 + 当前 override 状态
 * @param {Array} apiList - 上游 /meta/products 返回的 list
 * @returns {Array} 每项含 { product_code, bin, display_name, available, applicable_platforms, custom_message, has_override }
 */
function listAllWithMeta(apiList) {
  const map = loadAll();
  return apiList.map(p => {
    const ov = map.get(p.product_code);
    return {
      product_code:         p.product_code,
      bin:                  p.bin,
      display_name:         p.display_name || p.product_code,
      issuing_area:         p.issuing_area,
      issuing_area_code:    p.issuing_area_code,
      issuing_area_name:    p.issuing_area_name,
      issuing_area_flag:    p.issuing_area_flag,
      network:              p.network,
      remaining_open_card_num: p.remaining_open_card_num,
      // 生效后的值（override 优先）
      available:            ov ? ov.available : (p.available !== undefined ? p.available : true),
      applicable_platforms: ov ? ov.applicable_platforms : (p.applicable_platforms || null),
      custom_message:       ov ? ov.custom_message : (p.custom_message || null),
      has_override:         !!ov,
      updated_at:           ov ? ov.updated_at : null,
      updated_by:           ov ? ov.updated_by : null,
    };
  });
}

/**
 * upsert 管理员配置
 * @param {string} productCode
 * @param {Object} patch - { available?, applicable_platforms?, custom_message? }
 * @param {string} updatedBy - 管理员邮箱
 */
function upsert(productCode, patch, updatedBy) {
  if (!productCode) throw new Error('product_code required');
  const existing = get(productCode);
  const next = {
    available:            patch.available !== undefined ? !!patch.available : (existing ? existing.available : true),
    applicable_platforms: patch.applicable_platforms !== undefined
                            ? (Array.isArray(patch.applicable_platforms) ? patch.applicable_platforms : null)
                            : (existing ? existing.applicable_platforms : null),
    custom_message:       patch.custom_message !== undefined
                            ? (patch.custom_message || null)
                            : (existing ? existing.custom_message : null),
  };
  db.prepare(`
    INSERT INTO card_product_overrides (product_code, available, applicable_platforms, custom_message, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(product_code) DO UPDATE SET
      available = excluded.available,
      applicable_platforms = excluded.applicable_platforms,
      custom_message = excluded.custom_message,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(
    productCode,
    next.available ? 1 : 0,
    next.applicable_platforms ? JSON.stringify(next.applicable_platforms) : null,
    next.custom_message,
    Date.now(),
    updatedBy || null,
  );
  invalidate();
  return { product_code: productCode, ...next, updated_at: Date.now(), updated_by: updatedBy || null };
}

/**
 * 删除单个卡段的 override（恢复为 HARDCODED/docx 默认值）
 */
function remove(productCode) {
  if (!productCode) return false;
  const result = db.prepare('DELETE FROM card_product_overrides WHERE product_code = ?').run(productCode);
  invalidate();
  return result.changes > 0;
}

module.exports = {
  get,
  listAll,
  listAllWithMeta,
  upsert,
  remove,
  invalidate,
};
