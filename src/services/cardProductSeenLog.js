/**
 * src/services/cardProductSeenLog.js
 *
 * v1.0.75 卡段"首次出现"滑动窗口追踪 service
 *
 * 职责:
 *   - 维护 card_product_last_seen 单行表 (永远只有 1 行 id=1)
 *   - 记录"上一次上游拉取的 product_code 列表" (JSON 数组)
 *   - 提供对比函数: 给定当前上游列表, 返回 is_new 标记
 *   - 首次部署后第一次拉取时, 自动种子化 (不返回 NEW)
 *
 * 数据流:
 *   拉取上游 → last_seen (DB) → 对比 → current 中 is_new 标记
 *                          ↓
 *                  覆盖 last_seen = current codes
 *   派生数据: is_new 不持久化, 每次拉取临时算
 */
const db = require('../db');

/**
 * 读取上次记录的 product_code 列表
 * @returns {string[]} 上次拉取时上游出现过的 product_code 数组
 */
function getLastSeenCodes() {
  try {
    const row = db.prepare('SELECT codes FROM card_product_last_seen WHERE id = 1').get();
    if (!row || !row.codes) return [];
    const parsed = JSON.parse(row.codes);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('[cardProductSeenLog] getLastSeenCodes 失败:', e.message);
    return [];
  }
}

/**
 * 更新 last_seen 为当前上游 product_code 列表
 * @param {string[]} codes 当前上游 product_code 数组
 * @returns {boolean} 是否更新成功
 */
function setLastSeenCodes(codes) {
  try {
    const codesJson = JSON.stringify(Array.isArray(codes) ? codes : []);
    const now = new Date().toISOString();
    // UPSERT (id=1 永远只有 1 行)
    db.prepare(`
      INSERT INTO card_product_last_seen (id, codes, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET codes = excluded.codes, updated_at = excluded.updated_at
    `).run(codesJson, now);
    return true;
  } catch (e) {
    console.error('[cardProductSeenLog] setLastSeenCodes 失败:', e.message);
    return false;
  }
}

/**
 * 计算当前上游列表的 is_new 标记
 * @param {Array<{product_code: string}>} currentList 上游产品列表
 * @returns {Object.<string, boolean>} product_code → is_new 映射
 *
 * 算法 (滑动窗口):
 *   - last_seen 为空 (首次部署) → 全部 false (自动种子化, 不标 NEW)
 *   - last_seen 非空 → current 中不在 last_seen 的 = true (NEW)
 */
function computeIsNewMap(currentList) {
  const lastSeen = getLastSeenCodes();
  const isNewMap = {};
  const lastSeenSet = new Set(lastSeen);

  // 滑动窗口: last_seen 为空 = 首次种子化, 全部不标 NEW
  const isFirstRun = lastSeen.length === 0;

  for (const item of currentList) {
    if (!item || !item.product_code) continue;
    if (isFirstRun) {
      isNewMap[item.product_code] = false;  // 首次种子化, 全部不标 NEW
    } else {
      isNewMap[item.product_code] = !lastSeenSet.has(item.product_code);
    }
  }
  return isNewMap;
}

/**
 * 同步 last_seen (拉取上游后调用)
 * @param {Array<{product_code: string}>} currentList 当前上游产品列表
 * @returns {Object} { isNewMap, wasFirstRun } is_new 映射 + 是否首次种子化
 */
function syncAndCompute(currentList) {
  const isNewMap = computeIsNewMap(currentList);
  const wasFirstRun = getLastSeenCodes().length === 0;
  // 覆盖 last_seen = current codes (首次种子化也算, 反正要记)
  const codes = currentList
    .filter(p => p && p.product_code)
    .map(p => p.product_code);
  setLastSeenCodes(codes);
  return { isNewMap, wasFirstRun };
}

module.exports = {
  getLastSeenCodes,
  setLastSeenCodes,
  computeIsNewMap,
  syncAndCompute,
};
