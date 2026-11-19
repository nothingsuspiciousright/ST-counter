/** Discreet, opt-out completion feedback; no dependencies, sounds, or vibrations. */
let host = null;
let dismissId = null;
let hideId = null;
let previousText = '';
let previousAt = 0;

export function initNotifications() {
  if (host?.isConnected) return host;
  host = document.getElementById('mnemosyne-toast');
  if (!host) {
    host = document.createElement('div');
    host.id = 'mnemosyne-toast';
    host.className = 'mn-toast';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-atomic', 'true');
    host.setAttribute('aria-hidden', 'true');
    host.innerHTML = '<span class="mn-toast-glyph" aria-hidden="true">✦</span><span class="mn-toast-content"></span>';
    document.body.append(host);
    host.addEventListener('click', dismissNotification);
  }
  return host;
}

export function dismissNotification() {
  if (!host) return;
  clearTimeout(dismissId);
  clearTimeout(hideId);
  host.classList.remove('mn-toast-visible');
  hideId = setTimeout(() => {
    if (host && !host.classList.contains('mn-toast-visible')) host.setAttribute('aria-hidden', 'true');
  }, 270);
}

/** Called only after confirmed persistent update, never for every chat message. */
export function notifyMemoryUpdated(message = 'Память обновлена', enabled = true) {
  if (!enabled) return;
  const now = Date.now();
  const next = String(message || 'Память обновлена').slice(0, 160);
  // Repeated background events should update one toast rather than stack alerts.
  if (next === previousText && now - previousAt < 1800) return;
  previousText = next;
  previousAt = now;
  initNotifications();
  clearTimeout(dismissId);
  clearTimeout(hideId);
  host.querySelector('.mn-toast-content').textContent = next;
  host.setAttribute('aria-hidden', 'false');
  host.classList.add('mn-toast-visible');
  dismissId = setTimeout(dismissNotification, 3000);
}
