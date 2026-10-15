// Encrypts small JSON payloads (Canva tokens, PKCE verifier) for httpOnly
// cookies, so the app needs no database on Vercel.
const crypto = require('crypto');

function keyFrom(secret) {
  if (!secret || secret.length < 32) {
    throw new Error('CANVA_SESSION_SECRET must be at least 32 characters.');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function seal(obj, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((b) => b.toString('base64url')).join('.');
}

function unseal(token, secret) {
  try {
    const [iv, tag, encrypted] = token.split('.').map((s) => Buffer.from(s, 'base64url'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

module.exports = { seal, unseal };
