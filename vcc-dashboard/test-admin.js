// 直接测试卡片管理页面中的按钮显示问题
console.log('测试脚本开始...');

// 模拟用户登录为管理员
const _me = {
  id: 1,
  email: 'admin@vcc.hub',
  role: 'admin',
  name: '管理员'
};

console.log('模拟用户:', _me);
console.log('用户角色:', _me?.role);

// 测试条件判断
const isAdmin = _me?.role === 'admin';
console.log('isAdmin 条件结果:', isAdmin);

// 测试按钮HTML生成
const mockCard = {
  card_id: 'XR2037150794163163136',
  card_number: '1111111262391666',
  cvv: '123',
  expire: '07/28',
  available_amount: '30.00',
  status: 'ACTIVE'
};

const buttonHtml = `${_me?.role === 'admin' ? `<button class="cm-btn cm-btn-detail" onclick="showAdminCardDetail('${mockCard.card_id}')">🔍 详情</button>` : ''}`;
console.log('生成的按钮HTML:', buttonHtml);

// 检查showAdminCardDetail函数是否存在
if (typeof window.showAdminCardDetail !== 'function') {
  console.log('WARNING: window.showAdminCardDetail函数未定义！');
} else {
  console.log('window.showAdminCardDetail函数已定义');
}

// 测试全局函数调用
const testOnclick = `onclick="window.showAdminCardDetail('XR2037150794163163136')"`;
console.log('测试onclick属性:', testOnclick);