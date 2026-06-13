/* =========================================================
 * crypto-util.js - 공용 암호화 유틸 (WebCrypto)
 *  · 아이디+비밀번호 → PBKDF2(SHA-256) → AES-GCM 키
 *  · encryptJSON / decryptToText 는 브라우저(auth.js, app.js)와
 *    파이썬(cryptography)에서 동일한 파라미터로 상호 호환됩니다.
 * ========================================================= */
window.REMSCrypto = (function () {
  'use strict';

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  function bytesToB64(buf) {
    var bytes = new Uint8Array(buf);
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  async function deriveKey(id, pw, salt, iterations, usage) {
    var pass = new TextEncoder().encode(id + '\n' + pw);
    var baseKey = await crypto.subtle.importKey('raw', pass, 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, false, usage);
  }

  /** 객체를 암호화해 {v,iter,salt,iv,ct}(base64) 반환 */
  async function encryptJSON(id, pw, obj, iterations) {
    iterations = iterations || 250000;
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var key = await deriveKey(id, pw, salt, iterations, ['encrypt']);
    var pt = new TextEncoder().encode(JSON.stringify(obj));
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, pt);
    return { v: 1, iter: iterations, salt: bytesToB64(salt.buffer), iv: bytesToB64(iv.buffer), ct: bytesToB64(ct) };
  }

  /** 암호문 엔트리를 복호화해 평문 문자열 반환(실패 시 throw) */
  async function decryptToText(id, pw, entry) {
    var salt = b64ToBytes(entry.salt);
    var iv = b64ToBytes(entry.iv);
    var ct = b64ToBytes(entry.ct);
    var key = await deriveKey(id, pw, salt, entry.iter, ['decrypt']);
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    return new TextDecoder().decode(pt);
  }

  async function sha256hex(text) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    var bytes = new Uint8Array(buf);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return hex;
  }

  return { b64ToBytes: b64ToBytes, bytesToB64: bytesToB64, encryptJSON: encryptJSON, decryptToText: decryptToText, sha256hex: sha256hex };
})();
