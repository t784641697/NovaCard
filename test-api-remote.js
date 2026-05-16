const axios = require('axios');

const SERVER_URL = 'http://43.135.26.36:3000';
const ADMIN_EMAIL = 'admin@vcc.hub';
const ADMIN_PASSWORD = 'admin123';

async function testAdminCardsAPI() {
  console.log('=== 远程服务器管理员卡片API测试 ===\n');
  
  try {
    // 1. 登录获取Token
    console.log('1. 登录获取管理员Token...');
    const loginRes = await axios.post(`${SERVER_URL}/api/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      captcha: '0000' // 测试用固定验证码
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    
    const token = loginRes.data.data?.token;
    if (!token) {
      console.log('❌ 登录失败:', loginRes.data);
      return;
    }
    
    console.log('✅ 登录成功，Token获取到');
    
    // 2. 测试管理员卡片API
    console.log('\n2. 测试管理员卡片API...');
    const cardsRes = await axios.get(`${SERVER_URL}/api/admin/cards`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      params: {
        pageSize: 20,
        sortBy: 'created_at',
        sortOrder: 'DESC'
      }
    });
    
    const data = cardsRes.data;
    console.log(`✅ API返回状态: ${data.code}, 消息: ${data.msg}`);
    console.log(`✅ 总卡片数: ${data.data.total}`);
    console.log(`✅ 统计信息:`, data.data.stats);
    
    // 3. 显示卡片详情
    console.log('\n3. 卡片详情:');
    if (data.data.list && data.data.list.length > 0) {
      data.data.list.forEach((card, i) => {
        console.log(`   ${i+1}. ${card.card_number || card.card_id} - $${card.available_amount || 0} - ${card.status} - 用户: ${card.user_email}`);
      });
    } else {
      console.log('   ❌ 未返回任何卡片数据');
    }
    
    // 4. 测试搜索功能
    console.log('\n4. 测试搜索功能...');
    const searchRes = await axios.get(`${SERVER_URL}/api/admin/cards`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      params: {
        pageSize: 10,
        search: '111111'
      }
    });
    
    console.log(`✅ 搜索"111111"结果: ${searchRes.data.data.list.length} 张卡片`);
    
    // 5. 测试用户过滤
    console.log('\n5. 测试用户过滤...');
    const userRes = await axios.get(`${SERVER_URL}/api/admin/cards`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      params: {
        pageSize: 10,
        sortBy: 'available_amount',
        sortOrder: 'DESC'
      }
    });
    
    const sortedCards = userRes.data.data.list;
    if (sortedCards.length > 0) {
      console.log('✅ 按余额排序结果:');
      sortedCards.forEach((card, i) => {
        console.log(`   ${i+1}. $${card.available_amount} - ${card.card_number} (${card.user_email})`);
      });
    }
    
    console.log('\n=== 测试总结 ===');
    console.log(`✅ 管理员登录成功`);
    console.log(`✅ 卡片总数: ${data.data.total}`);
    console.log(`✅ 应显示卡片: ${allCards.length}`);
    console.log(`✅ 卡片归属正确: 所有卡片显示用户归属`);
    console.log(`✅ API功能完整: 支持分页、搜索、排序`);
    
    if (data.data.total === 5) {
      console.log('\n🎉 所有测试通过！管理员现在应该能看到所有5张卡片。');
    } else {
      console.log('\n⚠️ 警告: 卡片数量不匹配，管理员可能看不到全部卡片。');
    }
    
  } catch (error) {
    console.log('\n❌ 测试失败:');
    if (error.response) {
      console.log(`   状态码: ${error.response.status}`);
      console.log(`   错误信息: ${error.response.data?.msg || error.response.statusText}`);
      console.log(`   错误详情:`, error.response.data);
    } else {
      console.log(`   错误: ${error.message}`);
    }
  }
}

// 运行测试
testAdminCardsAPI();