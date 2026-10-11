'use strict';
// Cifrado en reposo de las cookies de sesión (AES-256-GCM).
// La clave sale de COOKIES_KEY (base64 de 32 bytes). Si no está, se deriva
// de QP_TOKEN con scrypt (funciona out-of-the-box, pero se recomienda setearla).
const crypto = require('crypto');

let KEY = null;
function key() {
  if (KEY) return KEY;
  const raw = process.env.COOKIES_KEY || '';
  if (raw) {
    let buf = null;
    try { buf = Buffer.from(raw, 'base64'); } catch (e) {}
    if (!buf || buf.length !== 32) buf = crypto.createHash('sha256').update(raw).digest();
    KEY = buf;
  } else {
    const seed = process.env.QP_TOKEN || 'qp-bajar-dev-seed';
    KEY = crypto.scryptSync(seed, 'qp-bajar-cookies-salt', 32);
  }
  return KEY;
}

// Devuelve base64(iv[12] || tag[16] || ciphertext)
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(Buffer.from(plaintext, 'utf8')), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function decrypt(b64) {
  const buf = Buffer.from(String(b64 || ''), 'base64');
  if (buf.length < 28) throw new Error('payload cifrado inválido');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
