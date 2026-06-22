/**
 * src/services/cardProductSeenLog.js
 *
 * v1.0.75 卡段"首次出现"滑动窗口追踪 service
 *
 * 职责:
 *   - 维护 card_product_last_seen 单行表 (永远只有 1 行 id=1)
 *   - 记录"上一次上游拉取的 product_code 列表" (JSON 数组)
 *   - 提供对比函数: 给定当前上游列表, 返回 is_new 标记
 *   - 首次部署后第一次 sync 时, 自动种子化 (isNewMap 全部为 false)
 *   - 提供 reset 接口: 重新拉取上游 + setLastSeenCodes (后续才标 NEW)
 *
 * 数据流:
 *   拉取上游 → last_seen (DB) → 对比 → current 中 is_new 标记
 *                          ↓
 *                  覆盖 last_seen = current codes
 *   派生数据: is_new 不持久化, 每次拉取临时算
 */
const db = require('../db');
const logger = require('../utils/logger');

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
    logger.error('[cardProductSeenLog] getLastSeenCodes 失败:', e.message);
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
    if (!Array.isArray(codes)) {
      logger.error('[cardProductSeenLog] setLastSeenCodes 失败: codes 不是数组');
      return false;
    }
    const json = JSON.stringify(codes);
    const now = Date.now();
    // UPSERT (id=1 单行表)
    const exists = db.prepare('SELECT 1 FROM card_product_last_seen WHERE id = 1').get();
    if (exists) {
      db.prepare('UPDATE card_product_last_seen SET codes = ?, updated_at = ? WHERE id = 1').run(json, now);
    } else {
      db.prepare('INSERT INTO card_product_last_seen (id, codes, updated_at) VALUES (1, ?, ?)').run(json, now);
    }
    return true;
  } catch (e) {
    logger.error('[cardProductSeenLog] setLastSeenCodes 失败:', e.message);
    return false;
  }
}

/**
 * 给定当前上游产品列表, 返回每个产品的 is_new 标记
 * @param {Array<{product_code: string}>} currentList 当前上游产品列表
 * @returns {boolean[]} 与 currentList 等长的 is_new 数组 (true = 新出现)
 */
function computeIsNewMap(currentList) {
  const last = getLastSeenCodes();
  const lastSet = new Set(last);
  return currentList.map(p => {
    if (!p || !p.product_code) return false;
    return !lastSet.has(p.product_code);
  });
}

/**
 * 同步 last_seen (拉取上游后调用)
 * 包含"首次种子化"逻辑: 首次部署时 last_seen 为空, 自动 setLastSeenCodes(current)
 * 但 isNewMap 全部返回 false (admin 不会看到 17 个假 NEW)
 *
 * @param {Array<{product_code: string}>} currentList 当前上游产品列表
 * @returns {{ isNewMap: boolean[], wasFirstRun: boolean }}
 *   isNewMap:  与 currentList 等长的 is_new 数组
 *   wasFirstRun: 是否首次种子化 (last_seen 从空到非空)
 */
function syncAndCompute(currentList) {
  const codes = (currentList || [])
    .filter(p => p && p.product_code)
    .map(p => p.product_code);

  const lastBefore = getLastSeenCodes();
  const wasFirstRun = lastBefore.length === 0;

  // 覆盖 last_seen = current codes
  setLastSeenCodes(codes);

  if (wasFirstRun) {
    // 首次部署, admin 不会看到 17 个假 NEW
    logger.info(`[cardProductSeenLog] 首次种子化: 记录 ${codes.length} 个产品`);
    return { isNewMap: codes.map(() => false), wasFirstRun: true };
  }

  // 正常 diff: 上次见过 = 旧的, 这次新出现 = NEW
  const lastSet = new Set(lastBefore);
  const isNewMap = codes.map(c => !lastSet.has(c));
  const newCount = isNewMap.filter(Boolean).length;
  if (newCount > 0) {
    logger.info(`[cardProductSeenLog] 同步 last_seen: 共 ${codes.length} 个, NEW ${newCount} 个`);
  }
  return { isNewMap, wasFirstRun: false };
}

/**
 * 手动 reset: 重新拉取上游 + 标记当前所有产品为"已见过"
 * 用于 admin 想"重新追踪所有当前卡段"时手动调用
 *
 * @param {Array<{product_code: string}>} currentList 当前上游产品列表
 * @returns {number} 被标记的产品数
 */
function markAllAsSeen(currentList) {
  const codes = (currentList || [])
    .filter(p => p && p.product_code)
    .map(p => p.product_code);
  setLastSeenCodes(codes);
  logger.info(`[cardProductSeenLog] 手动 reset: 标记 ${codes.length} 个产品为已见过`);
  return codes.length;
}

module.exports = {
  getLastSeenCodes,
  setLastSeenCodes,
  computeIsNewMap,
  syncAndCompute,
  markAllAsSeen,
};
