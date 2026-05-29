// Permission queries + requests with graceful fallbacks.
// Never requests anything implicitly – callers ask explicitly, always tied to a
// visible user action (privacy requirement).
import { caps } from './capabilities.js';

// Returns: 'granted' | 'denied' | 'prompt' | 'unsupported'
export async function queryPermission(name) {
  if (!caps.permissionsApi) return 'unsupported';
  try {
    const status = await navigator.permissions.query({ name });
    return status.state;
  } catch {
    // Safari throws for unknown names (e.g. 'microphone' on older versions).
    return 'unsupported';
  }
}

export const micPermission = () => queryPermission('microphone');
export const cameraPermission = () => queryPermission('camera');
export const geoPermission = () => queryPermission('geolocation');

export async function requestMicrophone() {
  if (!caps.getUserMedia) throw new Error('Mikrofon-API in diesem Browser nicht verfügbar.');
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

export function getPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!caps.geolocation) {
      reject(new Error('Standort wird in diesem Browser nicht unterstützt.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 9000,
      maximumAge: 60000,
      ...options,
    });
  });
}

export async function requestNotifications() {
  if (!caps.notifications) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

// Maps a permission state to a short, friendly German explanation.
export function explainState(kind, state) {
  const label = { microphone: 'Mikrofon', camera: 'Kamera', geolocation: 'Standort', notifications: 'Mitteilungen' }[kind] || kind;
  if (state === 'denied') {
    return `${label} ist blockiert. In den Browser-/Systemeinstellungen wieder erlauben.`;
  }
  if (state === 'unsupported') {
    return `${label} wird hier nicht unterstützt – kein Problem, die App funktioniert weiter.`;
  }
  return `${label} ist optional.`;
}
