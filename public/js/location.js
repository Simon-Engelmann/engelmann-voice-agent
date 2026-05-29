// Location context for the agent. Privacy-first: we only ask when allowed to,
// never read silently beyond what the OS permission already grants, and the app
// stays fully usable when location is denied or unavailable.
import { caps } from './capabilities.js';
import { geoPermission, getPosition } from './permissions.js';

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(`/api/reverse-geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.ok ? data.place : null;
  } catch {
    return null;
  }
}

// Returns one of:
//  { available:true, coords:{latitude,longitude,accuracy,timestamp}, place:{...}|null }
//  { available:false, reason:'denied'|'unsupported'|'error', message }
export async function getLocationContext() {
  if (!caps.geolocation) {
    return { available: false, reason: 'unsupported', message: 'Standort wird hier nicht unterstützt.' };
  }
  const state = await geoPermission();
  if (state === 'denied') {
    return { available: false, reason: 'denied', message: 'Standort ist blockiert – die App funktioniert trotzdem.' };
  }
  try {
    const pos = await getPosition();
    const coords = {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      timestamp: pos.timestamp,
    };
    const place = await reverseGeocode(coords.latitude, coords.longitude);
    return { available: true, coords, place };
  } catch (e) {
    const denied = e && (e.code === 1 || /denied/i.test(String(e.message)));
    return {
      available: false,
      reason: denied ? 'denied' : 'error',
      message: denied ? 'Standort wurde abgelehnt – kein Problem.' : 'Standort konnte nicht ermittelt werden.',
    };
  }
}

// Compact payload handed to the agent via the session token request.
export function toAgentPayload(ctx) {
  if (!ctx || !ctx.available) return null;
  return {
    latitude: ctx.coords.latitude,
    longitude: ctx.coords.longitude,
    accuracy: ctx.coords.accuracy,
    timestamp: ctx.coords.timestamp,
    place: ctx.place || null,
  };
}
