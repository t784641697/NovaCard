/**
 * 统一日志工具（winston）
 * - development：输出到控制台（彩色）
 * - production ：同时写入 logs/app.log + logs/error.log
 */

const { createLogger, format, transports } = require('winston');
const path = require('path');

const { combine, timestamp, printf, colorize, errors } = format;

const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  return `${timestamp} [${level}] ${stack || message}${metaStr}`;
});

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    new transports.Console({
      format: combine(colorize(), errors({ stack: true }), timestamp({ format: 'HH:mm:ss' }), logFormat),
    }),
  ],
});

// 生产环境额外写文件
if (process.env.NODE_ENV === 'production') {
  logger.add(new transports.File({
    filename: path.resolve('logs/error.log'),
    level: 'error',
  }));
  logger.add(new transports.File({
    filename: path.resolve('logs/app.log'),
  }));
}

module.exports = logger;
