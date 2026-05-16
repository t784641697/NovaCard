// ═══════════════════════════════════════════════════════
//  Topup 页面 - 充值中心
// ═══════════════════════════════════════════════════════

import { apiFetch } from '../services/api.js';
import { toast } from '../components/ui/toast.js';
import { formatNumber } from '../utils/helpers.js';

// 状态
let _selectedMethod = 'usdt';

/**
 * 渲染充值中心页面
 */
export async function renderTopup() {
  const area = document.getElementById('contentArea');
  if (!area) return;

  area.innerHTML = `
    <div class="page-header">
      <div class="flex items-center justify-between">
        <div>
          <h2>充值中心</h2>
          <p class="text-muted mt-1">充值到账户余额，支持 USDT 等方式</p>
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
      <!-- 充值方式 -->
      <div class="panel">
        <div style="font-weight:700;font-size:1rem;margin-bottom:20px;">选择充值方式</div>

        <div class="topup-method-list">
          <div class="topup-method-item ${_selectedMethod === 'usdt' ? 'selected' : ''}"
               onclick="selectTopupMethod('usdt')"
               style="
                 display:flex;align-items:center;gap:12px;
                 padding:16px;border-radius:12px;
                 border:2px solid ${_selectedMethod === 'usdt' ? '#00f2fe' : 'rgba(255,255,255,0.1)'};
                 background:rgba(255,255,255,0.03);
                 cursor:pointer;transition:all 0.2s;
                 margin-bottom:12px;
               ">
            <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#26a17b,#2ecc71);display:flex;align-items:center;justify-content:center;font-size:1.2rem;">💎</div>
            <div style="flex:1;">
              <div style="font-weight:600;">USDT (TRC20)</div>
              <div style="font-size:0.75rem;color:var(--text2);">支持 Tron 网络转账</div>
            </div>
            <div style="color:#00c758;font-weight:600;">推荐</div>
          </div>

          <div class="topup-method-item ${_selectedMethod === 'bank' ? 'selected' : ''}"
               onclick="selectTopupMethod('bank')"
               style="
                 display:flex;align-items:center;gap:12px;
                 padding:16px;border-radius:12px;
                 border:2px solid ${_selectedMethod === 'bank' ? '#00f2fe' : 'rgba(255,255,255,0.1)'};
                 background:rgba(255,255,255,0.03);
                 cursor:pointer;transition:all 0.2s;
                 opacity:0.5;
               ">
            <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#4facfe,#00f2fe);display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🏦</div>
            <div style="flex:1;">
              <div style="font-weight:600;">银行转账</div>
              <div style="font-size:0.75rem;color:var(--text2);">即将上线</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 充值表单 -->
      <div class="panel">
        <div style="font-weight:700;font-size:1rem;margin-bottom:20px;">填写充值信息</div>

        <form id="topupForm">
          <div class="form-group" style="margin-bottom:16px;">
            <label>充值金额 (USD)</label>
            <input type="number" id="topupAmount" class="form-control" placeholder="请输入金额" min="10" step="0.01" required>
            <div style="font-size:0.75rem;color:var(--text2);margin-top:4px;">最低充值 $10，汇率 1 USDT = 1 USD</div>
          </div>

          <div class="form-group" style="margin-bottom:16px;">
            <label>交易哈希 (TxHash)</label>
            <input type="text" id="topupTxHash" class="form-control" placeholder="转账完成后请输入交易哈希" required>
            <div style="font-size:0.75rem;color:var(--text2);margin-top:4px;">用于确认您的转账</div>
          </div>

          <div class="form-group" style="margin-bottom:20px;">
            <label>备注 (可选)</label>
            <input type="text" id="topupRemark" class="form-control" placeholder="如有备注请填写">
          </div>

          <!-- 充值地址显示 -->
          <div style="background:rgba(0,0,0,0.2);border-radius:12px;padding:16px;margin-bottom:20px;">
            <div style="font-size:0.8rem;color:var(--text2);margin-bottom:8px;">收款地址 (USDT-TRC20)</div>
            <div style="display:flex;gap:8px;align-items:center;">
              <code id="usdtAddress" style="flex:1;background:rgba(0,0,0,0.3);padding:12px;border-radius:8px;font-size:0.85rem;word-break:break-all;">加载中...</code>
              <button type="button" class="btn btn-sm btn-outline" onclick="copyUsdtAddress()">复制</button>
            </div>
          </div>

          <button type="submit" class="btn btn-primary btn-block" id="topupSubmitBtn" style="width:100%;">
            提交充值申请
          </button>
        </form>
      </div>
    </div>

    <!-- 充值记录 -->
    <div class="panel" style="margin-top:20px;">
      <div style="font-weight:700;font-size:1rem;margin-bottom:16px;">充值记录</div>
      <div id="topupHistory">
        <div class="skeleton" style="height:100px;border-radius:12px;"></div>
      </div>
    </div>
  `;

  // 绑定表单
  const form = document.getElementById('topupForm');
  if (form) {
    form.addEventListener('submit', handleTopupSubmit);
  }

  // 加载地址和记录
  await Promise.all([
    loadUsdtAddress(),
    loadTopupHistory()
  ]);
}

/**
 * 选择充值方式
 */
export function selectTopupMethod(method) {
  if (method === 'bank') {
    toast('⚠️ 银行转账即将上线');
    return;
  }

  _selectedMethod = method;

  // 更新选中样式
  document.querySelectorAll('.topup-method-item').forEach(el => {
    const isSelected = el.getAttribute('onclick').includes(`'${method}'`);
    el.style.border = isSelected ? '2px solid #00f2fe' : '2px solid rgba(255,255,255,0.1)';
    el.classList.toggle('selected', isSelected);
  });
}

/**
 * 加载 USDT 地址
 */
async function loadUsdtAddress() {
  const el = document.getElementById('usdtAddress');
  if (!el) return;

  try {
    const r = await apiFetch('/settings/usdt-address');
    if (r.code === 0 && r.data?.address) {
      el.textContent = r.data.address;
    } else {
      el.textContent = '地址获取失败，请联系客服';
    }
  } catch (e) {
    el.textContent = '地址获取失败';
  }
}

/**
 * 复制 USDT 地址
 */
export async function copyUsdtAddress() {
  const address = document.getElementById('usdtAddress')?.textContent;
  if (!address || address.includes('失败')) {
    toast('⚠️ 地址不可用');
    return;
  }

  try {
    await navigator.clipboard.writeText(address);
    toast('✅ 地址已复制');
  } catch (e) {
    toast('❌ 复制失败');
  }
}

/**
 * 处理充值提交
 */
async function handleTopupSubmit(e) {
  e.preventDefault();

  const amount = parseFloat(document.getElementById('topupAmount').value);
  const txHash = document.getElementById('topupTxHash').value.trim();
  const remark = document.getElementById('topupRemark').value.trim();

  if (!amount || amount < 10) {
    toast('⚠️ 最低充值 $10');
    return;
  }

  if (!txHash) {
    toast('⚠️ 请输入交易哈希');
    return;
  }

  const btn = document.getElementById('topupSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 提交中...';

  try {
    const res = await apiFetch('/topup/apply', {
      method: 'POST',
      body: JSON.stringify({
        amount: amount,
        tx_hash: txHash,
        method: _selectedMethod,
        remark: remark
      })
    });

    if (res.code !== 0) {
      toast('❌ ' + (res.msg || '提交失败'));
      return;
    }

    toast('✅ 充值申请已提交，等待审核');

    // 清空表单
    document.getElementById('topupAmount').value = '';
    document.getElementById('topupTxHash').value = '';
    document.getElementById('topupRemark').value = '';

    // 刷新记录
    await loadTopupHistory();
  } catch (e) {
    if (e.message !== 'Unauthorized') {
      toast('❌ 提交失败');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = '提交充值申请';
  }
}

/**
 * 加载充值记录
 */
async function loadTopupHistory() {
  const container = document.getElementById('topupHistory');
  if (!container) return;

  try {
    const r = await apiFetch('/topup/history?page_size=5');

    if (r.code !== 0 || !(r.data?.list || []).length) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);">暂无充值记录</div>';
      return;
    }

    const statusMap = {
      pending: { text: '待审核', color: '#ffb347' },
      approved: { text: '已通过', color: '#00c758' },
      rejected: { text: '已拒绝', color: '#ff5f5f' }
    };

    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>金额</th>
            <th>方式</th>
            <th>状态</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          ${r.data.list.map(item => {
            const status = statusMap[item.status] || { text: item.status, color: 'var(--text2)' };
            return `
              <tr>
                <td>${new Date(item.created_at).toLocaleString('zh-CN')}</td>
                <td>$${formatNumber(item.amount)}</td>
                <td>${item.method?.toUpperCase() || '-'}</td>
                <td><span style="color:${status.color}">${status.text}</span></td>
                <td>${item.remark || '-'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    if (e.message !== 'Unauthorized') {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red);">加载失败</div>';
    }
  }
}

// 导出到全局
if (typeof window !== 'undefined') {
  window.selectTopupMethod = selectTopupMethod;
  window.copyUsdtAddress = copyUsdtAddress;
}
