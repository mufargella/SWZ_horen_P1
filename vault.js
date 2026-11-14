/* SWZ Hören · password vault
 *
 * Each section (Aspekte neu B2 and Umgangssprache) is encrypted with its own
 * password by tools/build-encrypted-site.mjs. The published site contains only
 * the encrypted files (*.enc) plus ./assets/vault.json (salt + check value).
 * This script asks for the password, derives the AES key in the browser and
 * decrypts lessons, transcripts, audio and PDFs on demand.
 *
 * Without ./assets/vault.json (the unencrypted source folder) everything is
 * loaded directly and no password is asked.
 */
(() => {
  'use strict';
  const IS_UMG = document.documentElement.dataset.level === 'B1+–B2';
  // The start page (Aspekte) first shows only the section choice; the
  // password is asked after a section is picked. "back" returns to that choice.
  const SECTION = IS_UMG
    ? {id: 'umgangssprache', name: 'Umgangssprache · B1+–B2', back: '../'}
    : {id: 'aspekte', name: 'Aspekte neu B2', back: './'};
  const STORAGE_KEY = `swz-vault-${SECTION.id}-v1`;
  // Runs in <head> (not deferred) so the choice view appears without a flash
  // of the locked page. Corrected below once the stored key is verified.
  const root = document.documentElement;
  let hasStoredKey = false;
  try { hasStoredKey = !!localStorage.getItem(STORAGE_KEY); } catch (_) { /* No storage. */ }
  if (!IS_UMG && !hasStoredKey) root.classList.add('vault-choose');
  const CHECK_TEXT = 'SWZ-VAULT-OK';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const normalizePassword = (value) => String(value).normalize('NFKC').trim().toLowerCase();

  let config = null;
  let key = null;
  let plain = false;

  async function decrypt(buffer, cryptoKey = key) {
    const data = new Uint8Array(buffer);
    return crypto.subtle.decrypt({name: 'AES-GCM', iv: data.subarray(0, 12)}, cryptoKey, data.subarray(12));
  }
  async function derive(password) {
    const base = await crypto.subtle.importKey('raw', encoder.encode(normalizePassword(password)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      {name: 'PBKDF2', salt: fromBase64(config.salt), iterations: config.iterations, hash: 'SHA-256'},
      base, {name: 'AES-GCM', length: 256}, true, ['decrypt']);
  }
  async function verify(cryptoKey) {
    try { return decoder.decode(await decrypt(fromBase64(config.check), cryptoKey)) === CHECK_TEXT; }
    catch (_) { return false; }
  }
  function remember(cryptoKey) {
    crypto.subtle.exportKey('raw', cryptoKey)
      .then((raw) => { try { localStorage.setItem(STORAGE_KEY, toBase64(raw)); } catch (_) { /* Ask again next visit. */ } })
      .catch(() => {});
  }
  async function storedKey() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
    if (!raw) return null;
    try {
      const cryptoKey = await crypto.subtle.importKey('raw', fromBase64(raw), 'AES-GCM', true, ['decrypt']);
      if (await verify(cryptoKey)) return cryptoKey;
    } catch (_) { /* Fall through and forget the stale key. */ }
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* Nothing stored. */ }
    return null;
  }

  function waitForChoice() {
    // Start page: show the two section cards; picking Aspekte asks for its password.
    // The Umgangssprache card is a normal link to its own page (which asks there).
    return new Promise((resolve) => {
      root.classList.add('vault-choose');
      const onClick = (event) => {
        const card = event.target.closest?.('a.course-choice[aria-current="page"]');
        if (!card) return;
        event.preventDefault();
        document.removeEventListener('click', onClick, true);
        root.classList.remove('vault-choose');
        resolve();
      };
      document.addEventListener('click', onClick, true);
    });
  }

  function showLock() {
    return new Promise((resolve) => {
      root.classList.add('vault-locked');
      const overlay = document.createElement('div');
      overlay.className = 'vault-overlay';
      overlay.innerHTML = `
<div class="vault-card" role="dialog" aria-modal="true" aria-labelledby="vault-title" aria-describedby="vault-hint">
  <span class="brand-mark vault-brand" aria-hidden="true"><b>S</b><b>W</b><b>Z</b><i>• • •</i></span>
  <p class="eyebrow">Geschützter Bereich</p>
  <h1 id="vault-title"></h1>
  <p id="vault-hint" class="vault-hint">Gib das Passwort ein, das du von deinem Lehrer bekommen hast.</p>
  <p class="vault-hint vault-hint-ar" lang="ar-EG" dir="rtl">اكتب الباسورد اللي أخدته من المدرّس عشان تفتح التمارين.</p>
  <form class="vault-form" novalidate>
    <label for="vault-password">Passwort</label>
    <div class="vault-row">
      <input id="vault-password" name="password" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" required>
      <button class="primary-button" type="submit">Öffnen <span aria-hidden="true">↗</span></button>
    </div>
    <p class="vault-error" role="alert" hidden></p>
  </form>
  <a class="text-link vault-switch" href="${SECTION.back}"><span aria-hidden="true">←</span> Zurück zur Bereichsauswahl</a>
</div>`;
      overlay.querySelector('#vault-title').textContent = SECTION.name;
      document.body.append(overlay);
      const form = overlay.querySelector('form');
      const input = overlay.querySelector('input');
      const button = overlay.querySelector('button');
      const error = overlay.querySelector('.vault-error');
      const showError = (german, arabic) => {
        const de = document.createElement('span');
        de.textContent = german;
        const ar = document.createElement('span');
        ar.textContent = arabic; ar.lang = 'ar-EG'; ar.dir = 'rtl';
        error.replaceChildren(de, ar);
        error.hidden = false;
      };
      input.focus();
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!normalizePassword(input.value)) {
          showError('Bitte gib das Passwort ein.', 'اكتب الباسورد الأول.');
          input.focus();
          return;
        }
        button.disabled = true;
        input.setAttribute('aria-busy', 'true');
        error.hidden = true;
        let cryptoKey = null;
        try { cryptoKey = await derive(input.value); } catch (_) { cryptoKey = null; }
        if (cryptoKey && await verify(cryptoKey)) {
          remember(cryptoKey);
          overlay.remove();
          root.classList.remove('vault-locked');
          resolve(cryptoKey);
          return;
        }
        button.disabled = false;
        input.removeAttribute('aria-busy');
        showError('Falsches Passwort. Versuch es noch einmal.', 'الباسورد غلط، جرّب تاني.');
        input.select();
        input.focus();
      });
    });
  }

  const ready = (async () => {
    const response = await fetch('./assets/vault.json', {cache: 'no-cache'});
    if (response.status === 404) { plain = true; root.classList.remove('vault-choose'); return; }
    if (!response.ok) throw new Error(`Vault config HTTP ${response.status}`);
    config = await response.json();
    if (!window.crypto?.subtle) throw new Error('Web Crypto is not available');
    if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, {once: true}));
    key = await storedKey();
    if (key) { root.classList.remove('vault-choose'); return; }
    if (!IS_UMG) await waitForChoice();
    key = await showLock();
  })();

  async function readWithProgress(response, onProgress) {
    const total = Number(response.headers.get('content-length')) || 0;
    if (!onProgress || !total || !response.body?.getReader) return response.arrayBuffer();
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    let lastPercent = -1;
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      const percent = Math.min(99, Math.floor((received / total) * 100));
      if (percent !== lastPercent) { lastPercent = percent; onProgress(percent); }
    }
    const out = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
    return out.buffer;
  }
  async function bytes(path, fetchOptions = {}, onProgress = null) {
    await ready;
    const response = await fetch(plain ? path : `${path}.enc`, fetchOptions);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
    const buffer = await readWithProgress(response, onProgress);
    return plain ? buffer : decrypt(buffer);
  }
  async function json(path) {
    return JSON.parse(decoder.decode(await bytes(path, {cache: 'no-cache'})));
  }
  async function objectURL(path, type, onProgress = null) {
    await ready;
    if (plain) return path;
    return URL.createObjectURL(new Blob([await bytes(path, {}, onProgress)], {type}));
  }

  // PDF links carry data-vault-file; decrypt and hand the file over as a download.
  document.addEventListener('click', async (event) => {
    const link = event.target.closest?.('a[data-vault-file]');
    if (!link || plain || event.defaultPrevented) return;
    event.preventDefault();
    if (link.dataset.vaultBusy) return;
    link.dataset.vaultBusy = 'true';
    link.setAttribute('aria-busy', 'true');
    try {
      const file = link.dataset.vaultFile;
      const url = await objectURL(file, 'application/pdf');
      const save = document.createElement('a');
      save.href = url;
      save.download = link.getAttribute('download') || file.split('/').pop();
      save.hidden = true;
      document.body.append(save);
      save.click();
      save.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      console.error('SWZ vault: PDF could not be prepared', error);
      const toast = document.getElementById('toast');
      if (toast) {
        toast.textContent = 'Die PDF konnte nicht geladen werden. Prüfe deine Verbindung und versuche es erneut.';
        toast.hidden = false;
        setTimeout(() => { toast.hidden = true; }, 6500);
      }
    } finally {
      delete link.dataset.vaultBusy;
      link.removeAttribute('aria-busy');
    }
  });

  window.SWZVault = {ready, bytes, json, objectURL, get encrypted() { return !plain; }};
})();
