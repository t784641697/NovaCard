// ═══════════════════════════════════════════════════════
//  Apply 页面 - 申请开卡
// ═══════════════════════════════════════════════════════

import { apiFetch } from '../services/api.js';
import { toast } from '../components/ui/toast.js';
import { formatNumber } from '../utils/helpers.js';

// 状态
let _selectedCardType = null;
let _cardTypesCache = null;

/**
 * 渲染申请卡片页面
 */
export async function renderApply() {
  const area = document.getElementById('contentArea');
  if (!area) return;

  area.innerHTML = `
    <div class="page-header">
      <div class="flex items-center justify-between">
        <div>
          <h2>申请开卡</h2>
          <p class="text-muted mt-1">选择卡段，提交开卡申请</p>
        </div>
      </div>
    </div>

    <div class="panel">
      <div style="font-weight:700;font-size:1rem;margin-bottom:20px;">选择卡类型</div>
      <div id="cardTypesList" class="card-types-grid">
        <div class="skeleton" style="height:120px;border-radius:12px;"></div>
        <div class="skeleton" style="height:120px;border-radius:12px;"></div>
        <div class="skeleton" style="height:120px;border-radius:12px;"></div>
      </div>
    </div>

    <div class="panel" id="applyFormPanel" style="display:none;">
      <div style="font-weight:700;font-size:1rem;margin-bottom:20px;">填写申请信息</div>
      <form id="applyForm">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
          <div class="form-group">
            <label>姓氏</label>
            <input type="text" id="applyFirstName" class="form-control" placeholder="如: Zhang" required>
          </div>
          <div class="form-group">
            <label>名字</label>
            <input type="text" id="applyLastName" class="form-control" placeholder="如: San" required>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
          <div class="form-group">
            <label>充值金额 (USD)</label>
            <input type="number" id="applyAmount" class="form-control" placeholder="最低 $10" min="10" step="0.01" required>
            <div style="font-size:0.75rem;color:var(--text2);margin-top:4px;">开卡费: $<span id="applyFee">0</span></div>
          </div>
          <div class="form-group">
            <label>有效期 (月)</label>
            <select id="applyMonths" class="form-control">
              <option value="12">12个月</option>
              <option value="24">24个月</option>
              <option value="36">36个月</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label>用途说明</label>
          <textarea id="applyPurpose" class="form-control" rows="2" placeholder="请简要说明卡片用途..."></textarea>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:24px;">
          <button type="button" class="btn btn-outline" onclick="gotoPage('cards')">取消</button>
          <button type="submit" class="btn btn-primary" id="applySubmitBtn">提交申请</button>
        </div>
      </form>
    </div>
  `;

  // 绑定表单提交
  const form = document.getElementById('applyForm');
  if (form) {
    form.addEventListener('submit', handleApplySubmit);
  }

  // 加载卡类型
  await loadCardTypes();
}

/**
 * 加载卡类型列表
 */
async function loadCardTypes() {
  const container = document.getElementById('cardTypesList');
  if (!container) return;

  try {
    // 如果有缓存直接显示
    if (_cardTypesCache) {
      renderCardTypes(_cardTypesCache);
      return;
    }

    const r = await apiFetch('/card-types');
    if (r.code !== 0) {
      container.innerHTML = `<div class="empty-state">❌ 加载失败: ${r.msg}</div>`;
      return;
    }

    _cardTypesCache = r.data || [];
    renderCardTypes(_cardTypesCache);
  } catch (e) {
    if (e.message !== 'Unauthorized') {
      container.innerHTML = '<div class="empty-state">❌ 网络错误</div>';
    }
  }
}

/**
 * 渲染卡类型列表
 */
function renderCardTypes(types) {
  const container = document.getElementById('cardTypesList');
  if (!container) return;

  if (types.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无可用卡类型</div>';
    return;
  }

  container.innerHTML = types.map(type => `
    <div class="card-type-item ${type.id === _selectedCardType?.id ? 'selected' : ''}"
         data-id="${type.id}"
         onclick="selectCardType('${type.id}')"
         style="
           background: linear-gradient(135deg, ${type.bg_color || '#667eea'} 0%, ${type.accent_color || '#764ba2'} 100%);
           border-radius: 12px;
           padding: 16px;
           cursor: pointer;
           border: 2px solid ${type.id === _selectedCardType?.id ? '#00f2fe' : 'transparent'};
           transition: all 0.2s;
         ">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-weight:600;">${type.name}</span>
        <span style="font-size:0.75rem;opacity:0.8;">${type.card_brand || 'VISA'}</span>
      </div>
      <div style="font-size:0.8rem;opacity:0.9;margin-bottom:4px;">开卡费: $${formatNumber(type.open_fee)}</div>
      <div style="font-size:0.75rem;opacity:0.7;">${type.description || ''}</div>
    </div>
  `).join('');
}

/**
 * 选择卡类型
 */
export function selectCardType(typeId) {
  const type = _cardTypesCache?.find(t => t.id === typeId);
  if (!type) return;

  _selectedCardType = type;

  // 更新选中样式
  document.querySelectorAll('.card-type-item').forEach(el => {
    el.style.border = el.dataset.id === typeId ? '2px solid #00f2fe' : '2px solid transparent';
  });

  // 显示表单
  const formPanel = document.getElementById('applyFormPanel');
  if (formPanel) {
    formPanel.style.display = 'block';
    formPanel.scrollIntoView({ behavior: 'smooth' });
  }

  // 更新费用显示
  const feeEl = document.getElementById('applyFee');
  if (feeEl) {
    feeEl.textContent = formatNumber(type.open_fee);
  }
}

/**
 * 处理申请提交
 */
async function handleApplySubmit(e) {
  e.preventDefault();

  if (!_selectedCardType) {
    toast('⚠️ 请先选择卡类型');
    return;
  }

  const firstName = document.getElementById('applyFirstName').value.trim();
  const lastName = document.getElementById('applyLastName').value.trim();
  const amount = parseFloat(document.getElementById('applyAmount').value);
  const months = parseInt(document.getElementById('applyMonths').value);
  const purpose = document.getElementById('applyPurpose').value.trim();

  // 校验
  if (!firstName || !lastName) {
    toast('⚠️ 请填写姓名');
    return;
  }

  if (!amount || amount < 10) {
    toast('⚠️ 充值金额最低 $10');
    return;
  }

  const btn = document.getElementById('applySubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 提交中...';

  try {
    const res = await apiFetch('/cards/apply', {
      method: 'POST',
      body: JSON.stringify({
        card_type_id: _selectedCardType.id,
        first_name: firstName,
        last_name: lastName,
        amount: amount,
        months: months,
        purpose: purpose
      })
    });

    if (res.code !== 0) {
      toast('❌ ' + (res.msg || '申请失败'));
      return;
    }

    toast('✅ 申请提交成功！');
    gotoPage('cards');
  } catch (e) {
    if (e.message !== 'Unauthorized') {
      toast('❌ 申请失败');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = '提交申请';
  }
}

// 导出到全局
if (typeof window !== 'undefined') {
  window.selectCardType = selectCardType;
}
