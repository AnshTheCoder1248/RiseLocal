const EARTH_RADIUS_MI = 3958.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceMi(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}

export function boundingBox(center: { lat: number; lng: number }, radiusMi: number) {
  const dLat = radiusMi / 69;
  const dLng = radiusMi / (69 * Math.cos(rad(center.lat)) || 1);
  return { minLat: center.lat - dLat, maxLat: center.lat + dLat, minLng: center.lng - dLng, maxLng: center.lng + dLng };
}

/** Coarsen coordinates (~1 km) so exact locations are never stored for display (SAFE-1). */
export const coarsen = (n: number | null | undefined) => (n == null ? n : Math.round(n * 100) / 100);
