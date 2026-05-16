// ═══════════════════════════════════════════════════════
//  Overview 页面 - 账户总览
// ═══════════════════════════════════════════════════════

import { apiFetch } from '../services/api.js';
import { toast } from '../components/ui/toast.js';
import { _me } from '../utils/config.js';
import { formatNumber } from '../utils/helpers.js';

// Chart 实例缓存
let _ovChartInstance = null;
let _ovTxCache = null;

/**
 * 渲染总览页面
 */
export async function renderOverview() {
  const area = document.getElementById('contentArea');
  if (!area) return;

  area.innerHTML = `
    <div class="page-header">
      <div class="flex items-center justify-between">
        <div>
          <h2>账户总览</h2>
          <p class="text-muted mt-1">资产状况一目了然</p>
        </div>
        <button class="btn btn-primary" onclick="gotoPage('apply')">✨ 申请开卡</button>
      </div>
    </div>

    <div class="ov-stat-row">
      <div class="ov-stat-card">
        <div class="ov-stat-label">账户余额</div>
        <div class="ov-stat-val grad-text" id="ovBalance">$—</div>
      </div>
      <div class="ov-stat-card">
        <div class="ov-stat-label">活跃卡片</div>
        <div class="ov-stat-val grad-text" id="ovCardCount">—</div>
        <div class="ov-stat-hint">未冻结 · 未过期</div>
      </div>
    </div>

    <div class="panel mb-4">
      <div class="flex items-center justify-between mb-4">
        <div style="font-weight:700;font-size:.95rem">消费趋势</div>
        <div class="ov-tab-group">
          <button class="ov-tab active" onclick="switchOvTab(7,this)">近7天</button>
          <button class="ov-tab" onclick="switchOvTab(30,this)">近30天</button>
          <button class="ov-tab" onclick="switchOvTab(90,this)">近90天</button>
        </div>
      </div>
      <div style="position:relative;height:200px">
        <canvas id="ovChart"></canvas>
        <div id="ovChartEmpty" style="display:none;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:.85rem">暂无交易数据</div>
      </div>
    </div>

    <div class="panel">
      <div style="font-weight:700;font-size:.95rem;margin-bottom:16px">最近交易记录</div>
      <div id="ovTxList"><div class="skeleton" style="height:200px;border-radius:10px;"></div></div>
    </div>
  `;

  // 并发加载数据
  await Promise.all([
    loadOvBalance(),
    loadOvCards(),
    loadOvChart(7),
    loadOvTxList()
  ]);
}

/**
 * 加载账户余额
 */
async function loadOvBalance() {
  const el = document.getElementById('ovBalance');
  if (!el) return;

  try {
    if (_me?.role === 'admin') {
      // 管理员：显示商户余额
      const labelEl = el.previousElementSibling;
      if (labelEl) labelEl.textContent = '商户余额';
      const r = await apiFetch('/admin/stats');
      if (r?.code === 0 && r?.data?.merchant_balance != null) {
        el.textContent = '$' + formatNumber(r.data.merchant_balance);
      } else {
        el.textContent = '$—';
      }
    } else {
      // 普通用户：显示个人账户余额
      const r = await apiFetch('/cards/account/balance');
      el.textContent = r.code === 0 ? '$' + formatNumber(r.data.balance) : '$—';
    }
  } catch (e) {
    el.textContent = '$—';
  }
}

/**
 * 加载活跃卡片数量
 */
async function loadOvCards() {
  const el = document.getElementById('ovCardCount');
  if (!el) return;

  try {
    const r = await apiFetch('/cards');
    if (r.code !== 0) {
      el.textContent = '—';
      return;
    }

    const now = new Date();
    const active = (r.data || []).filter(c => {
      if (c.error) return false;
      if ((c.status || '').toUpperCase() !== 'ACTIVE') return false;
      // 过期判断
      if (c.expire) {
        const [mm, yy] = c.expire.split('/');
        const exp = new Date(2000 + parseInt(yy || 0), parseInt(mm || 1) - 1, 1);
        if (exp < now) return false;
      }
      return true;
    });

    el.textContent = active.length;
  } catch (e) {
    el.textContent = '—';
  }
}

/**
 * 加载消费趋势图表
 */
export async function loadOvChart(days) {
  const canvas = document.getElementById('ovChart');
  if (!canvas) return;

  // 获取交易数据
  if (!_ovTxCache) {
    try {
      const r = await apiFetch('/transactions?page_size=200');
      _ovTxCache = (r.code === 0 && r.data?.list) ? r.data.list : [];
    } catch (e) {
      _ovTxCache = [];
    }
  }

  // 只保留消费成功的记录
  const successTx = _ovTxCache.filter(t => {
    const type = (t.transaction_type || t.type || '').toLowerCase();
    const status = (t.status || '').toLowerCase();
    return status === 'success' && (type.includes('consume') || type.includes('spend') || type.includes('payment'));
  });

  // 按天聚合
  const now = new Date();
  const labels = [];
  const values = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${d.getMonth() + 1}/${d.getDate()}`;
    labels.push(key);

    const dayTotal = successTx.filter(t => {
      const td = new Date(t.auth_time || t.created_at || 0);
      return td.getFullYear() === d.getFullYear() &&
             td.getMonth() === d.getMonth() &&
             td.getDate() === d.getDate();
    }).reduce((sum, t) => sum + Math.abs(Number(t.transaction_amount || t.amount || 0)), 0);

    values.push(parseFloat(dayTotal.toFixed(2)));
  }

  const hasData = values.some(v => v > 0);
  const emptyEl = document.getElementById('ovChartEmpty');
  if (emptyEl) {
    emptyEl.style.display = hasData ? 'none' : 'flex';
  }

  // 销毁旧图表
  if (_ovChartInstance) {
    _ovChartInstance.destroy();
    _ovChartInstance = null;
  }

  // 创建新图表
  if (typeof Chart !== 'undefined') {
    _ovChartInstance = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: '消费金额 ($)',
          data: values,
          borderColor: '#00f2fe',
          backgroundColor: 'rgba(0,242,254,0.08)',
          pointBackgroundColor: '#00f2fe',
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.4,
          fill: true,
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e253a',
            borderColor: 'rgba(0,242,254,.2)',
            borderWidth: 1,
            titleColor: '#a6aabe',
            bodyColor: '#e1e5f9',
            callbacks: {
              label: ctx => ' $' + ctx.parsed.y.toFixed(2)
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,.04)' },
            ticks: {
              color: '#707587',
              font: { size: 11 },
              maxTicksLimit: days <= 7 ? 7 : 10
            }
          },
          y: {
            grid: { color: 'rgba(255,255,255,.04)' },
            ticks: {
              color: '#707587',
              font: { size: 11 },
              callback: v => '$' + v
            }
          }
        }
      }
    });
  }
}

/**
 * 切换图表时间范围
 */
export function switchOvTab(days, btn) {
  document.querySelectorAll('.ov-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _ovTxCache = null; // 切换天数时重新拉取
  loadOvChart(days);
}

/**
 * 加载最近交易记录
 */
async function loadOvTxList() {
  const wrap = document.getElementById('ovTxList');
  if (!wrap) return;

  const TABLE_HEAD = `
    <div class="ov-tx-head">
      <div>卡BIN</div>
      <div>卡产品</div>
      <div>商户名称</div>
      <div>交易类型</div>
      <div>交易状态</div>
      <div style="text-align:right">交易金额</div>
      <div style="text-align:right">交易时间</div>
    </div>`;

  try {
    const r = await apiFetch('/transactions?page_size=10');
    if (r.code !== 0 || !(r.data?.list || []).length) {
      wrap.innerHTML = TABLE_HEAD +
        '<div style="text-align:center;padding:28px 0;color:var(--text3);font-size:.85rem">暂无交易记录</div>';
      return;
    }

    const txTypeMap = {
      Authorization: '消费授权',
      Settlement: '清算',
      Refund: '退款',
      Reversal: '撤销',
    };

    const txStatusMap = {
      PENDING: { cls: 'tag-yellow', label: '清算中' },
      DECLINED: { cls: 'tag-red', label: '失败' },
      COMPLETE: { cls: 'tag-green', label: '完成' },
    };

    const rows = r.data.list.map(t => {
      const typeRaw = (t.transaction_type || '').toString();
      const typeCn = txTypeMap[typeRaw] || typeRaw || '—';
      const statusRaw = (t.status || '').toUpperCase();
      const statusInfo = txStatusMap[statusRaw] || { cls: 'tag-purple', label: statusRaw || '—' };
      const bin = (t.card_id || '').slice(0, 6) || '—';
      const product = t.product_code || '—';
      const merchant = t.merchant_name || '—';
      const txAmt = t.amount !== undefined ? Number(t.amount) : null;
      const amtColor = txAmt !== null && txAmt < 0 ? 'var(--red)' :
                       txAmt !== null && txAmt > 0 ? 'var(--green)' : 'var(--text2)';
      const dt = t.start_time
        ? new Date(t.start_time).toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          })
        : '—';

      return `
        <div class="ov-tx-row">
          <div class="ov-tx-cell">${bin}</div>
          <div class="ov-tx-cell">${product}</div>
          <div class="ov-tx-cell ov-tx-merchant">${merchant}</div>
          <div class="ov-tx-cell"><span class="tag tag-blue" style="font-size:.68rem">${typeCn}</span></div>
          <div class="ov-tx-cell"><span class="tag ${statusInfo.cls}" style="font-size:.68rem">${statusInfo.label}</span></div>
          <div class="ov-tx-cell" style="text-align:right;font-weight:700;color:${amtColor}">
            ${txAmt !== null ? (txAmt >= 0 ? '+' : '') + txAmt.toFixed(2) : '—'}
          </div>
          <div class="ov-tx-cell" style="text-align:right;color:var(--text3);font-size:.78rem">${dt}</div>
        </div>`;
    }).join('');

    wrap.innerHTML = TABLE_HEAD + `<div class="ov-tx-body">${rows}</div>`;
  } catch (e) {
    if (e.message !== 'Unauthorized') {
      wrap.innerHTML = '<div style="color:var(--red);font-size:.85rem;padding:12px">加载失败</div>';
    }
  }
}

// 导出到全局（供HTML事件使用）
if (typeof window !== 'undefined') {
  window.switchOvTab = switchOvTab;
}
