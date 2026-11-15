import { api, type GeoPoint } from './api'

/** Where the user is now, named by reverse geocoding (falls back to "My location"). */
export function currentPosition(timeout = 10000): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available in this browser.'))
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords
        try { resolve((await api.reverse(lat, lon)) ?? { name: 'My location', lat, lon }) } catch { resolve({ name: 'My location', lat, lon }) }
      },
      (e) => reject(new Error(e.code === 1 ? 'Location permission was denied. Allow it in the browser to plan from where you are.' : 'Could not get your location. Try again outdoors or type the place.')),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    )
  })
}

/** Ask once per session: live location is used as the default start in both modes. */
export async function shouldAutoLocate(): Promise<boolean> {
  try {
    if (sessionStorage.getItem('tz-autolocated')) return false
    sessionStorage.setItem('tz-autolocated', '1')
    const p = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
    return !p || p.state !== 'denied'
  } catch { return false }
}
