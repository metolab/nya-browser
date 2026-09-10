export const GEO_PERMISSIONS = ['ask', 'allow', 'block'] as const;

export type GeoPermission = (typeof GEO_PERMISSIONS)[number];

export type GeoConfig = {
  permission: GeoPermission;
  latitude: number | null;
  longitude: number | null;
  accuracy: number;
};

export const DEFAULT_GEO: GeoConfig = {
  permission: 'ask',
  latitude: null,
  longitude: null,
  accuracy: 100,
};

export function isGeoPermission(value: unknown): value is GeoPermission {
  return GEO_PERMISSIONS.includes(value as GeoPermission);
}

export function coerceGeoPermission(input: unknown): GeoPermission {
  const raw = String(input || '')
    .trim()
    .toLowerCase();
  return isGeoPermission(raw) ? raw : 'ask';
}

function clipCoord(value: unknown, min: number, max: number): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

export function normalizeGeo(input: unknown): GeoConfig {
  const obj = input && typeof input === 'object' ? (input as Partial<GeoConfig>) : {};
  const accuracy = Number(obj.accuracy);
  const latitude = clipCoord(obj.latitude, -90, 90);
  const longitude = clipCoord(obj.longitude, -180, 180);
  let permission = coerceGeoPermission(obj.permission);
  if (permission === 'allow' && (latitude == null || longitude == null)) {
    permission = 'ask';
  }
  return {
    permission,
    latitude,
    longitude,
    accuracy:
      Number.isFinite(accuracy) && accuracy >= 10 && accuracy <= 5000
        ? Math.floor(accuracy)
        : DEFAULT_GEO.accuracy,
  };
}

export function geoHasCoordinates(geo: GeoConfig) {
  return geo.latitude != null && geo.longitude != null;
}
