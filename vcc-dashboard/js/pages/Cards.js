// ═══════════════════════════════════════════════════════
//  Cards 页面 - 我的卡片
// ═══════════════════════════════════════════════════════

import { apiFetch } from '../services/api.js';
import { toast } from '../components/ui/toast.js';
import { _me } from '../utils/config.js';
import { formatNumber, copyVal } from '../utils/helpers.js';

// 模块级状态
let _cardsCache = null;
let _cardsLoading = false;

/**
 * 渲染卡片列表页面（用户视图）
 */
export async function renderCards() {
  const area = document.getElementById('contentArea');
  if (!area) return;

  area.innerHTML = `
    <div class="page-header">
      <div class="flex items-center justify-between">
        <div>
          <h2>我的卡片</h2>
          <p class="text-muted mt-1">管理您的虚拟卡</p>
        </div>
        <button class="btn btn-primary" onclick="gotoPage('apply')">✨ 申请新卡</button>
      </div>
    </div>
    <div id="cardsList" class="cards-grid">
      <div class="skeleton" style="height:200px;border-radius:16px;"></div>
      <div class="skeleton" style="height:200px;border-radius:16px;"></div>
    </div>
  `;

  await loadCardsList();
}

/**
 * 加载卡片列表
 */
async function loadCardsList() {
  const container = document.getElementById('cardsList');
  if (!container) return;

  try {
    _cardsLoading = true;
    const r = await apiFetch('/cards');

    if (r.code !== 0) {
      container.innerHTML = `<div class="empty-state">❌ 加载失败: ${r.msg}</div>`;
      return;
    }

    const cards = r.data || [];
    _cardsCache = cards;

    if (cards.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div style="font-size:48px;margin-bottom:16px">💳</div>
          <div style="color:var(--text2);margin-bottom:16px">暂无卡片</div>
          <button class="btn btn-primary" onclick="gotoPage('apply')">申请第一张卡片</button>
        </div>
      `;
      return;
    }

    // 渲染卡片网格
    container.innerHTML = cards.map((card, index) => renderCardItem(card, index)).join('');

    // 绑定卡片点击事件
    cards.forEach(card => {
      const el = document.getElementById(`card-${card.card_id}`);
      if (el) {
        el.addEventListener('click', () => showCardDetail(card.card_id));
      }
    });

  } catch (e) {
    if (e.message !== 'Unauthorized') {
      container.innerHTML = '<div class="empty-state">❌ 网络错误，请稍后重试</div>';
    }
  } finally {
    _cardsLoading = false;
  }
}

/**
 * 渲染单个卡片
 */
function renderCardItem(card, index) {
  const isActive = (card.status || '').toUpperCase() === 'ACTIVE';
  const isInvalid = card.verified_status === 'invalid';
  const balance = card.available_amount !== undefined ? Number(card.available_amount) : 0;

  // 卡片渐变样式
  const grads = [
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  ];
  const grad = grads[index % grads.length];

  // 卡号脱敏
  const cardNum = (card.card_number || '****').replace(/(\d{4})(?=\d)/g, '$1 ');
  const maskedNum = cardNum.slice(-8).padStart(cardNum.length, '*');

  return `
    <div id="card-${card.card_id}" class="card-item" style="
      background: ${grad};
      border-radius: 16px;
      padding: 20px;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
      position: relative;
      overflow: hidden;
    " onmouseenter="this.style.transform='translateY(-4px)';this.style.boxShadow='0 12px 24px rgba(0,0,0,0.3)'"
       onmouseleave="this.style.transform='';this.style.boxShadow=''">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <span style="font-weight:600;font-size:0.9rem;opacity:0.9">${/visa/i.test(card.card_type || '') ? 'VISA' : 'MASTERCARD'}</span>
        <span style="
          width:8px;height:8px;border-radius:50%;
          background:${isActive ? '#00c758' : isInvalid ? '#94a3b8' : '#ff5f5f'};
          box-shadow:0 0 8px ${isActive ? '#00c758' : isInvalid ? '#94a3b8' : '#ff5f5f'};
        "></span>
      </div>
      <div style="font-family:monospace;font-size:1.2rem;letter-spacing:2px;margin-bottom:20px;">
        ${maskedNum}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;">
        <div>
          <div style="font-size:0.75rem;opacity:0.7;margin-bottom:4px;">可用余额</div>
          <div style="font-size:1.3rem;font-weight:700;">$${formatNumber(balance)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.75rem;opacity:0.7;margin-bottom:4px;">有效期</div>
          <div style="font-size:0.9rem;">${card.expire || '--/--'}</div>
        </div>
      </div>
      ${isInvalid ? '<div style="position:absolute;top:12px;right:12px;background:rgba(255,95,95,0.9);color:white;padding:4px 12px;border-radius:20px;font-size:0.75rem;font-weight:600;">已失效</div>' : ''}
    </div>
  `;
}

/**
 * 显示卡片详情
 */
export async function showCardDetail(cardId) {
  // 查找缓存的卡片数据
  const card = _cardsCache?.find(c => c.card_id === cardId);
  if (!card) {
    toast('❌ 卡片数据不存在');
    return;
  }

  const isActive = (card.status || '').toUpperCase() === 'ACTIVE';
  const isInvalid = card.verified_status === 'invalid';

  // 创建弹窗内容
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    display: flex; align-items: center; justify-content: center;
    z-index: 10000; opacity: 0; transition: opacity 0.3s;
  `;

  const cardNum = (card.card_number || '').replace(/(\d{4})(?=\d)/g, '$1 ');

  modal.innerHTML = `
    <div style="
      background: linear-gradient(135deg, #13192a 0%, #1d2035 100%);
      border: 1px solid rgba(167,139,250,0.15);
      border-radius: 16px;
      width: 90%; max-width: 480px;
      max-height: 85vh; overflow-y: auto;
      transform: scale(0.9); transition: transform 0.3s;
    ">
      <div style="padding: 20px 24px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin: 0; font-size: 1.1rem; background: linear-gradient(135deg,#7eb8f7,#a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">卡片详情</h3>
        <button class="modal-close" style="background: none; border: none; color: var(--text2); font-size: 24px; cursor: pointer;">×</button>
      </div>
      <div style="padding: 24px;">
        <!-- 卡片预览 -->
        <div style="
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 12px; padding: 20px; margin-bottom: 20px;
        ">
          <div style="display: flex; justify-content: space-between; margin-bottom: 16px;">
            <span style="font-weight: 600;">${/visa/i.test(card.card_type || '') ? 'VISA' : 'MASTERCARD'}</span>
            <span style="width: 8px; height: 8px; border-radius: 50%; background: ${isActive ? '#00c758' : '#ff5f5f'};"></span>
          </div>
          <div style="font-family: monospace; font-size: 1.1rem; letter-spacing: 2px; margin-bottom: 16px;">
            ${cardNum || '**** **** **** ****'}
          </div>
          <div style="display: flex; justify-content: space-between;">
            <div>
              <div style="font-size: 0.7rem; opacity: 0.8;">持卡人</div>
              <div style="font-size: 0.85rem;">${card.first_name || ''} ${card.last_name || ''}</div>
            </div>
            <div style="text-align: center;">
              <div style="font-size: 0.7rem; opacity: 0.8;">CVV</div>
              <div style="font-size: 0.85rem; filter: blur(4px); cursor: pointer;" onclick="this.style.filter=this.style.filter?'':'blur(4px)'">${card.cvv || '***'}</div>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 0.7rem; opacity: 0.8;">有效期</div>
              <div style="font-size: 0.85rem;">${card.expire || '--/--'}</div>
            </div>
          </div>
        </div>

        <!-- 详细信息 -->
        <div style="margin-bottom: 20px;">
          ${renderDetailRow('Card ID', card.card_id, true)}
          ${renderDetailRow('卡类型', card.card_type)}
          ${renderDetailRow('状态', isActive ? '✅ 正常' : isInvalid ? '❌ 已失效' : '🔒 已冻结')}
          ${renderDetailRow('可用余额', '$' + formatNumber(card.available_amount))}
          ${card.card_address ? renderDetailRow('地址', [
            card.card_address.address_line_one,
            card.card_address.city,
            card.card_address.country
          ].filter(Boolean).join(', ')) : ''}
        </div>

        <!-- 操作按钮 -->
        <div style="display: flex; gap: 12px;">
          ${!isInvalid ? `<button class="btn btn-primary flex-1" onclick="rechargeCard('${card.card_id}')">💰 充值</button>` : ''}
          ${!isInvalid ? `<button class="btn btn-outline flex-1" onclick="toggleCardFreeze('${card.card_id}', '${card.status}')">${isActive ? '🔒 冻结' : '🔓 解冻'}</button>` : ''}
          <button class="btn btn-outline" onclick="copyVal('${card.card_number}')">📋 复制卡号</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // 动画
  requestAnimationFrame(() => {
    modal.style.opacity = '1';
    modal.querySelector('div > div').style.transform = 'scale(1)';
  });

  // 关闭事件
  modal.querySelector('.modal-close').addEventListener('click', () => {
    modal.style.opacity = '0';
    setTimeout(() => modal.remove(), 300);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.opacity = '0';
      setTimeout(() => modal.remove(), 300);
    }
  });
}

/**
 * 渲染详情行
 */
function renderDetailRow(label, value, monospace = false) {
  if (value === undefined || value === null || value === '') return '';
  return `
    <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
      <span style="color: var(--text2); font-size: 0.85rem;">${label}</span>
      <span style="font-family: ${monospace ? 'monospace' : 'inherit'}; font-size: 0.9rem; font-weight: 500;">${value}</span>
    </div>
  `;
}

/**
 * 充值卡片
 */
export async function rechargeCard(cardId) {
  const amount = prompt('请输入充值金额（USD）：', '100');
  if (!amount || isNaN(amount) || amount <= 0) {
    toast('⚠️ 请输入有效金额');
    return;
  }

  if (parseFloat(amount) < 10) {
    toast('⚠️ 最低充值 $10');
    return;
  }

  try {
    const res = await apiFetch(`/cards/${cardId}/recharge`, {
      method: 'POST',
      body: JSON.stringify({ amount: parseFloat(amount) })
    });

    if (res.code !== 0) {
      toast('❌ ' + (res.msg || '充值失败'));
      return;
    }

    toast(`✅ 充值 $${amount} 成功`);
    // 刷新卡片列表
    await loadCardsList();
  } catch (e) {
    if (e.message !== 'Unauthorized') {
      toast('❌ 充值失败');
    }
  }
}

/**
 * 冻结/解冻卡片
 */
export async function toggleCardFreeze(cardId, currentStatus) {
  const cur = String(currentStatus).toUpperCase();
  const newStatus = cur === 'CANCELLED' ? 'ACTIVE' : 'CANCELLED';
  const action = newStatus === 'CANCELLED' ? '冻结' : '解冻';

  if (!confirm(`确认要${action}该卡片吗？`)) return;

  try {
    const res = await apiFetch(`/cards/${cardId}/freeze`, {
      method: 'POST',
      body: JSON.stringify({ status: newStatus })
    });

    if (res.code !== 0) {
      toast('❌ ' + (res.msg || `${action}失败`));
      return;
    }

    toast(`✅ 卡片已${action}`);
    await loadCardsList();
  } catch (e) {
    if (e.message !== 'Unauthorized') {
      toast('❌ 操作失败');
    }
  }
}

// 导出到全局
if (typeof window !== 'undefined') {
  window.showCardDetail = showCardDetail;
  window.rechargeCard = rechargeCard;
  window.toggleCardFreeze = toggleCardFreeze;
}
