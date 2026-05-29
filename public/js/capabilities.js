// Central capability / environment detection.
// Pure feature detection – no side effects, no permission prompts.
const ua = navigator.userAgent || '';
const platform = navigator.platform || '';
const maxTouch = navigator.maxTouchPoints || 0;

// iPadOS 13+ reports as "MacIntel" with touch points, so detect it explicitly.
export const isIPadOS = platform === 'MacIntel' && maxTouch > 1;
export const isIOS = /iPad|iPhone|iPod/.test(ua) || isIPadOS;
export const isAndroid = /Android/.test(ua);
export const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua) || isIOS;
export const isMobile = isIOS || isAndroid || /Mobi/i.test(ua);

export function isStandalone() {
  return (
    window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches
  );
}

function hasCaptureAttribute() {
  try {
    return 'capture' in document.createElement('input');
  } catch {
    return false;
  }
}

export const caps = {
  secureContext: window.isSecureContext === true,
  permissionsApi: Boolean(navigator.permissions && navigator.permissions.query),
  geolocation: 'geolocation' in navigator,
  mediaDevices: Boolean(navigator.mediaDevices),
  getUserMedia: Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  mediaRecorder: typeof window.MediaRecorder !== 'undefined',
  clipboardRead: Boolean(navigator.clipboard && navigator.clipboard.readText),
  clipboardWrite: Boolean(navigator.clipboard && navigator.clipboard.writeText),
  webShare: typeof navigator.share === 'function',
  canShare: typeof navigator.canShare === 'function',
  serviceWorker: 'serviceWorker' in navigator,
  notifications: 'Notification' in window,
  fileInput: true,
  captureAttribute: hasCaptureAttribute(),
};

export function deviceClass() {
  if (isIPadOS) return 'ipados';
  if (isIOS) return 'ios';
  if (isAndroid) return 'android';
  return 'desktop';
}

export function summary() {
  return {
    deviceClass: deviceClass(),
    isIOS,
    isIPadOS,
    isAndroid,
    isSafari,
    isMobile,
    standalone: isStandalone(),
    ...caps,
  };
}
