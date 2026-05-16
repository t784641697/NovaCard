#!/usr/bin/env node
/**
 * 批量验证所有卡片在vmcardio平台上的真实状态
 * 用法: node batch-verify-cards.js [all|pending]
 *   - all: 验证所有卡片（默认，用于每日验证确保数据一致性）
 *   - pending: 只验证待验证的卡片
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const vmcardioSDK = require('./src/services/vmcardioSDK');

// 解析命令行参数
const mode = process.argv[2] || 'all'; // 默认验证所有卡片
const verifyAll = mode === 'all';

// 配置
const dbPath = path.join(__dirname, 'data/vcc.db');
const db = new Database(dbPath, { readonly: false, fileMustExist: true });

// 日志文件路径
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logFile = path.join(logDir, `verify-${new Date().toISOString().split('T')[0]}.log`);

function log(msg, type = 'INFO') {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${type}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

async function batchVerifyCards() {
  const startTime = Date.now();
  log(`========== 开始批量验证卡片 ==========`, 'INFO');
  log(`验证模式: ${verifyAll ? '全部卡片' : '仅待验证卡片'}`, 'INFO');
  
  // 获取待验证的卡片
  let cards;
  if (verifyAll) {
    cards = db.prepare(`
      SELECT id, card_id, user_id, card_number, verified_status 
      FROM cards 
      ORDER BY id
    `).all();
    log(`数据库中共有 ${cards.length} 张卡片`, 'INFO');
  } else {
    cards = db.prepare(`
      SELECT id, card_id, user_id, card_number, verified_status 
      FROM cards 
      WHERE verified_status IS NULL OR verified_status = 'pending'
      ORDER BY id
    `).all();
    log(`找到 ${cards.length} 张待验证的卡片`, 'INFO');
  }
  
  if (cards.length === 0) {
    log('没有需要验证的卡片', 'INFO');
    return;
  }
  
  if (cards.length === 0) {
    console.log('没有需要验证的卡片');
    return;
  }
  
  const updateStmt = db.prepare(`
    UPDATE cards 
    SET last_verified = datetime('now'), verified_status = ?, verification_error = ?
    WHERE card_id = ?
  `);
  
  let validCount = 0;
  let invalidCount = 0;
  let errorCount = 0;
  
  // 逐张验证
  for (const card of cards) {
    console.log(`验证卡片 ${card.card_id} (${card.card_number})...`);
    
    try {
      // 调用vmcardio接口验证卡片
      const detail = await vmcardioSDK.cardDetail(card.card_id);
      
      // 验证成功
      updateStmt.run('valid', null, card.card_id);
      console.log(`  ✓ 验证成功: ${card.card_id} 有效`);
      validCount++;
      
    } catch (sdkErr) {
      // 验证失败
      const errorMsg = sdkErr.vmMsg || sdkErr.message || '未知错误';
      
      // 判断是否为"无效卡片"错误
      if (errorMsg.includes('Invalid CardId') || errorMsg.includes('卡不存在')) {
        updateStmt.run('invalid', errorMsg, card.card_id);
        console.log(`  ✗ 验证失败: ${card.card_id} 无效 (${errorMsg})`);
        invalidCount++;
      } else {
        // 其他错误（如网络错误、API错误等）
        updateStmt.run('error', errorMsg, card.card_id);
        console.log(`  ⚠ 验证错误: ${card.card_id} (${errorMsg})`);
        errorCount++;
      }
    }
    
    // 稍微延迟一下，避免请求过快
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n=== 批量验证完成 ===');
  console.log(`有效卡片: ${validCount} 张`);
  console.log(`无效卡片: ${invalidCount} 张`);
  console.log(`验证错误: ${errorCount} 张`);
  console.log(`总计验证: ${cards.length} 张`);
  
  // 显示最终统计
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN verified_status = 'valid' THEN 1 ELSE 0 END) as valid,
      SUM(CASE WHEN verified_status = 'invalid' THEN 1 ELSE 0 END) as invalid,
      SUM(CASE WHEN verified_status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN verified_status = 'error' THEN 1 ELSE 0 END) as error
    FROM cards
  `).get();
  
  console.log('\n=== 数据库统计 ===');
  console.log(`总卡片数: ${stats.total}`);
  console.log(`有效: ${stats.valid || 0}`);
  console.log(`无效: ${stats.invalid || 0}`);
  console.log(`待验证: ${stats.pending || 0}`);
  console.log(`验证错误: ${stats.error || 0}`);
}

// 运行批量验证
batchVerifyCards()
  .then(() => {
    console.log('\n批量验证任务完成');
    process.exit(0);
  })
  .catch(error => {
    console.error('批量验证失败:', error);
    process.exit(1);
  });