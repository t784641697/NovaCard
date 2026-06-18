/**
 * 国家/地区名称 + 国旗 emoji 标准化
 *
 * 解决 vmcardio 上游 API 返回的 issuing_area 字段值不统一问题：
 *   - 部分卡段返回 ISO 3166-1 alpha-2:  "HK" / "US" / "GB" / "SG"
 *   - 部分返回全称:                   "Hong Kong SAR" / "United States" / "United Kingdom"
 *   - 部分返回缩写:                   "UK" / "USA" / "US"
 *
 * 策略：
 *   1. ALIAS 兜底表: 仅覆盖"非 ISO 自由文本" → 映射成 ISO 码
 *   2. Intl.DisplayNames: ISO 码 → 中文（Node 18+ 内置，支持 250+ 国家/地区）
 *   3. 字母偏移算法:    ISO 码 → 国旗 emoji（regional indicator symbols）
 *   4. 终极兜底:        原样返回 + 白旗
 *
 * 优势:
 *   - 真正的可扩展: 任何 ISO 国家/地区都自动支持（无需修改代码）
 *   - 唯一需要维护的"映射"就是 ALIAS 兜底表（只覆盖"非 ISO 自由文本"）
 *   - 新增国家时大概率上游会直接返回 ISO 码，连 ALIAS 都不用改
 */

// zh-CN + style: 'short' → "香港"/"美国"/"英国"/"澳门" (简短的常用名)
const _dn = new Intl.DisplayNames(['zh-CN'], { type: 'region', style: 'short' });

// 仅覆盖"非 ISO 自由文本" → ISO 3166-1 alpha-2
// ISO 码本身不需要列在这里，Intl.DisplayNames 会自动处理
const COUNTRY_ALIAS = {
  // 常见缩写
  'UK': 'GB',
  'USA': 'US',
  'U.S.A.': 'US',
  'U.S.': 'US',
  'PRC': 'CN',
  'Mainland China': 'CN',

  // 地区全称
  'Hong Kong SAR': 'HK',
  'Hong Kong': 'HK',
  'United States': 'US',
  'United States of America': 'US',
  'United Kingdom': 'GB',
  'Great Britain': 'GB',
  'England': 'GB',
  'Scotland': 'GB',
  'Northern Ireland': 'GB',
  'Singapore': 'SG',

  // 地区简称
  'Macao SAR': 'MO',
  'Macao': 'MO',
  'Macau': 'MO',
  'Taiwan': 'TW',
  'Korea': 'KR',
  'South Korea': 'KR',
  'North Korea': 'KP',
};

/**
 * 把上游任意格式的国家/地区名标准化
 * @param {string} raw - 上游 API 返回的 issuing_area 原始值
 * @returns {{ code: string, name: string, flag: string }}
 */
function normalizeCountry(raw) {
  if (raw === null || raw === undefined) {
    return { code: '', name: '', flag: '' };
  }
  const text = String(raw).trim();
  if (!text) {
    return { code: '', name: '', flag: '' };
  }

  // 1. 查别名表 → ISO 3166-1 alpha-2
  const aliased = COUNTRY_ALIAS[text];
  const code = (aliased || text).toUpperCase();

  // 2. ISO 码 → 中文 (Intl.DisplayNames 自动支持 250+ 国家/地区)
  let name = '';
  if (code.length === 2) {
    try {
      name = _dn.of(code) || '';
    } catch (e) {
      // Intl 不识别这个 ISO 码时走兜底
      name = '';
    }
  }

  // 3. ISO 码 → 国旗 emoji (regional indicator symbols)
  // 🇭🇰 = String.fromCodePoint(0x1F1E6 + 'H'-'A', 0x1F1E6 + 'K'-'A')
  let flag = '';
  if (/^[A-Z]{2}$/.test(code)) {
    flag = String.fromCodePoint(
      0x1F1E6 + (code.charCodeAt(0) - 65),
      0x1F1E6 + (code.charCodeAt(1) - 65)
    );
  }

  return {
    code,
    name: name || text,    // 兜底: Intl 没识别就用原始文本
    flag: flag || '🏳️',   // 兜底: 白旗
  };
}

module.exports = { normalizeCountry, COUNTRY_ALIAS };
