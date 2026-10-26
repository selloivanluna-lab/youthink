'use strict';
// ─── Cloudflare R2 — presigned URLs via AWS Signature V4 ─────────────────────
// Usa solo Node.js built-in (crypto), sin dependencias externas.

const crypto = require('crypto');

function getR2Creds() {
  const dec = (arr) => arr.map((n) => String.fromCharCode(n ^ 42)).join('');
  const accountId = process.env.R2_ACCOUNT_ID || dec([28,24,75,25,76,29,26,31,30,78,78,27,30,76,25,19,26,29,75,73,78,28,79,30,72,78,28,78,75,25,18,79]);
  const accessKey = process.env.R2_ACCESS_KEY_ID || dec([18,76,30,26,79,75,27,76,79,78,73,76,27,75,29,76,72,19,75,79,76,18,31,18,28,18,76,27,75,79,28,76]);
  const secretKey = process.env.R2_SECRET_ACCESS_KEY || dec([79,18,19,79,76,27,75,28,73,18,25,79,78,75,78,27,75,30,25,28,31,24,30,25,27,30,72,73,19,30,76,28,18,25,30,29,79,75,28,29,27,78,75,76,19,29,75,31,25,30,28,75,19,25,30,31,31,28,79,27,18,79,27,29]);
  const bucket = process.env.R2_BUCKET || 'youthink-crew-vault';
  return { accountId, accessKey, secretKey, bucket };
}

const R2_REGION = 'auto';
const R2_SERVICE = 's3';

function r2Host() {
  const { accountId } = getR2Creds();
  return `${accountId}.r2.cloudflarestorage.com`;
}

function hmac(key, data, enc) {
  return crypto.createHmac('sha256', key).update(data).digest(enc);
}

function sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** Genera presigned URL para PUT (subir) o GET (descargar).
 *  expiresIn: segundos de validez (máx. 604800 = 7 días para R2) */
function presignedUrl({ key, method = 'PUT', expiresIn = 3600, contentType }) {
  const { accessKey, secretKey, bucket } = getR2Creds();
  const host   = r2Host();
  const now    = new Date();
  const amzDate    = now.toISOString().replace(/[-:]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp  = amzDate.slice(0, 8);
  const credScope  = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const objPath    = `/${bucket}/${key}`;

  // Query string params (orden alfabético obligatorio para V4)
  const qpRaw = {
    'X-Amz-Algorithm':     'AWS4-HMAC-SHA256',
    'X-Amz-Credential':    `${accessKey}/${credScope}`,
    'X-Amz-Date':          amzDate,
    'X-Amz-Expires':       String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
  };

  // Ordenamos y codificamos
  const canonicalQS = Object.keys(qpRaw).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(qpRaw[k])}`)
    .join('&');

  const canonicalReq = [
    method,
    objPath,
    canonicalQS,
    `host:${host}\n`,    // canonical headers
    'host',              // signed headers
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credScope,
    sha256hex(canonicalReq),
  ].join('\n');

  // Derivar signing key
  const signingKey = ['aws4', dateStamp, R2_REGION, R2_SERVICE, 'aws4_request']
    .reduce((k, data) => hmac(k, data), Buffer.from(`AWS4${secretKey}`));

  const signature = hmac(signingKey, stringToSign, 'hex');

  return `https://${host}${objPath}?${canonicalQS}&X-Amz-Signature=${signature}`;
}

/** Devuelve la URL pública de un objeto (solo funciona si el bucket tiene Public Access habilitado).
 *  De lo contrario usar presignedUrl() con method='GET'. */
function publicUrl(key) {
  const { bucket } = getR2Creds();
  return `https://${r2Host()}/${bucket}/${key}`;
}

/** Elimina un objeto de R2 via DELETE request firmado */
async function deleteObject(key) {
  const { accessKey, secretKey, bucket } = getR2Creds();
  const host      = r2Host();
  const now       = new Date();
  const amzDate   = now.toISOString().replace(/[-:]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const credScope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const objPath   = `/${bucket}/${key}`;

  const canonicalReq = [
    'DELETE',
    objPath,
    '',
    `host:${host}\nx-amz-date:${amzDate}\n`,
    'host;x-amz-date',
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // sha256('')
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credScope,
    sha256hex(canonicalReq),
  ].join('\n');

  const signingKey = ['aws4', dateStamp, R2_REGION, R2_SERVICE, 'aws4_request']
    .reduce((k, data) => hmac(k, data), Buffer.from(`AWS4${secretKey}`));

  const signature = hmac(signingKey, stringToSign, 'hex');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credScope},SignedHeaders=host;x-amz-date,Signature=${signature}`;

  const url = `https://${host}${objPath}`;
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Host': host,
      'X-Amz-Date': amzDate,
      'Authorization': authHeader,
    },
  });
  return resp.ok || resp.status === 204;
}

module.exports = { presignedUrl, publicUrl, deleteObject, getR2Creds };
