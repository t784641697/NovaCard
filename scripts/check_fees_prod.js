const db = require('./src/db');
const types = db.prepare("SELECT DISTINCT fee_type FROM transactions WHERE fee_type IS NOT NULL AND fee_type != ''").all();
console.log("交易中的fee_type:", types.map(t => t.fee_type));
const configs = db.prepare("SELECT fee_type, description FROM fee_configs WHERE is_active=1").all();
console.log("费用配置描述:", configs.map(c => c.fee_type + '=' + c.description));