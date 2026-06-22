/**
 * 场景派生工具 (v1.0.70)
 *
 * 核心职责: 根据"卡段的适用平台列表 applicable_platforms (或 docx_platforms)"
 *           + "管理员配置的场景映射" → 派生该卡段属于哪些场景
 *
 * 匹配规则: B - 精确匹配 + 大小写不敏感
 *   - 关键词与 platform 项去除首尾空格 + toLowerCase() 后严格相等
 *   - 不做 includes 模糊匹配, 避免误判 (如 'Amazon Prime' 不会被 'Amazon' 命中)
 *
 * 数据来源:
 *   - scenarios: [{ id, scenario_name, scenario_icon, sort_order, platforms: [...], enabled }]
 *   - product: { applicable_platforms: [...], docx_platforms: [...] }
 *
 * 设计取舍:
 *   - 派生逻辑放服务端, 前端零额外逻辑
 *   - 一个卡段可同时属于多个场景 (例如 S5395YL 同时支持社交媒体 + AI 订阅)
 *   - 派生结果在 /meta/products 接口里实时计算, 不缓存 (配置变化时自动跟随)
 */

/**
 * 标准化 platform 字符串 (去除首尾空格 + 转小写)
 * @param {string} s
 * @returns {string}
 */
function norm(s) {
  return String(s || '').trim().toLowerCase();
}

/**
 * 检查单个 platform 是否命中某个 scenario
 * @param {string} platform - 卡段的某个 platform, 如 'Facebook' / 'OpenAI'
 * @param {string[]} keywords - scenario 的平台关键词, 如 ['Facebook','Instagram']
 * @returns {boolean}
 */
function matchesScenario(platform, keywords) {
  const p = norm(platform);
  if (!p) return false;
  return keywords.some(kw => norm(kw) === p);
}

/**
 * 派生某个产品所属的场景列表
 * @param {Object} product - 包含 applicable_platforms / docx_platforms
 * @param {Array}  scenarios - 启用的场景列表 (DB 拉取)
 * @returns {string[]} 命中的场景名称数组 (按 sort_order 升序)
 */
function deriveScenariosForProduct(product, scenarios) {
  if (!Array.isArray(scenarios) || scenarios.length === 0) return [];

  // 优先用 applicable_platforms (管理员覆盖), 没有则回退到 docx_platforms
  const platforms = (Array.isArray(product.applicable_platforms) && product.applicable_platforms.length > 0)
    ? product.applicable_platforms
    : (Array.isArray(product.docx_platforms) ? product.docx_platforms : []);

  if (platforms.length === 0) return [];

  const matched = [];
  // 按 sort_order 升序遍历, 保证返回顺序稳定
  const sorted = [...scenarios].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  for (const sc of sorted) {
    if (sc.enabled === 0 || sc.enabled === false) continue; // 跳过禁用场景
    const keywords = Array.isArray(sc.platforms) ? sc.platforms : [];
    if (keywords.length === 0) continue;
    // 任一 platform 命中该 scenario 的任一关键词, 就算匹配
    if (platforms.some(p => matchesScenario(p, keywords))) {
      matched.push(sc.scenario_name);
    }
  }
  return matched;
}

/**
 * 批量派生 (给 /meta/products 用)
 * @param {Array} products - 产品列表
 * @param {Array} scenarios - 场景列表
 * @returns {Array} 每个 product 增加 derived_scenarios 字段 (不动原 product 对象)
 */
function deriveScenariosBatch(products, scenarios) {
  if (!Array.isArray(products)) return [];
  return products.map(p => {
    const derived = deriveScenariosForProduct(p, scenarios);
    return { ...p, derived_scenarios: derived };
  });
}

module.exports = {
  norm,
  matchesScenario,
  deriveScenariosForProduct,
  deriveScenariosBatch,
};
