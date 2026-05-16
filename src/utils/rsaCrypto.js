/**
 * RSA 加解密工具
 * vmcardio 使用 PKCS#1 v1.5，RSA
 *
 * 请求流程：
 *   原始 payload → JSON.stringify → 分段 RSA 公钥加密（平台公钥）→ Base64 → HEX 编码 → content 字段
 *
 * 响应流程：
 *   data 字段（HEX）→ HEX 解码 → Base64 解码 → 分段 RSA 私钥解密（商户私钥）→ JSON.parse → 业务数据
 *
 * 注意：vmcardio 文档明确指出 content 是 Base64 → HEX 双重编码；分段解密处理长密文。
 */

const forge = require('node-forge');
const fs    = require('fs');
const path  = require('path');

class RsaCrypto {
  constructor() {
    this._platformPublicKey  = null; // 平台公钥（加密请求用）
    this._merchantPrivateKey = null; // 商户私钥（解密响应用）
  }

  // ── 懒加载密钥（只读一次）─────────────────────────────────────────────
  _loadPlatformPublicKey() {
    if (this._platformPublicKey) return this._platformPublicKey;
    const keyPath = process.env.VMCARDIO_PLATFORM_PUBLIC_KEY_PATH;
    if (!keyPath) throw new Error('VMCARDIO_PLATFORM_PUBLIC_KEY_PATH 未配置');
    const pem = fs.readFileSync(path.resolve(keyPath), 'utf8');
    this._platformPublicKey = forge.pki.publicKeyFromPem(pem);
    return this._platformPublicKey;
  }

  _loadMerchantPrivateKey() {
    if (this._merchantPrivateKey) return this._merchantPrivateKey;
    const keyPath = process.env.VMCARDIO_MERCHANT_PRIVATE_KEY_PATH;
    if (!keyPath) throw new Error('VMCARDIO_MERCHANT_PRIVATE_KEY_PATH 未配置');
    const pem = fs.readFileSync(path.resolve(keyPath), 'utf8');
    this._merchantPrivateKey = forge.pki.privateKeyFromPem(pem);
    return this._merchantPrivateKey;
  }

  /**
   * 计算 RSA 公钥单次最大加密明文字节数（PKCS#1 v1.5：key_len - 11）
   */
  _maxEncryptSize(publicKey) {
    return Math.floor(publicKey.n.bitLength() / 8) - 11;
  }

  /**
   * 计算 RSA 私钥单次解密块大小（= key_len 字节）
   */
  _blockSize(privateKey) {
    return Math.ceil(privateKey.n.bitLength() / 8);
  }

  /**
   * 加密请求体
   * 流程：JSON → UTF-8 bytes → 分段 RSA 加密 → 各段 concat → Base64 → HEX
   * @param {object} payload
   * @returns {string} HEX 编码密文（作为 content 字段）
   */
  encrypt(payload) {
    const publicKey  = this._loadPlatformPublicKey();
    const plaintext  = forge.util.encodeUtf8(JSON.stringify(payload));
    const maxLen     = this._maxEncryptSize(publicKey);
    let encryptedBuf = '';

    for (let i = 0; i < plaintext.length; i += maxLen) {
      const chunk = plaintext.slice(i, i + maxLen);
      encryptedBuf += publicKey.encrypt(chunk, 'RSAES-PKCS1-V1_5');
    }

    // Base64 → HEX
    const base64 = forge.util.encode64(encryptedBuf);
    return Buffer.from(base64, 'utf8').toString('hex');
  }

  /**
   * 解密响应体
   * 流程：HEX → Base64 → 分段 RSA 解密 → JSON.parse
   * @param {string} hexData - vmcardio 返回的 data 字段（HEX）
   * @returns {object|string} 解密后的业务数据
   */
  decrypt(hexData) {
    const privateKey = this._loadMerchantPrivateKey();
    // HEX → Base64 → binary
    const base64     = Buffer.from(hexData, 'hex').toString('utf8');
    const encrypted  = forge.util.decode64(base64);
    const blockSize  = this._blockSize(privateKey);
    let decrypted    = '';

    for (let i = 0; i < encrypted.length; i += blockSize) {
      const chunk = encrypted.slice(i, i + blockSize);
      decrypted  += privateKey.decrypt(chunk, 'RSAES-PKCS1-V1_5');
    }

    const result = forge.util.decodeUtf8(decrypted);
    try {
      return JSON.parse(result);
    } catch {
      return result;
    }
  }
}

// 单例
module.exports = new RsaCrypto();
