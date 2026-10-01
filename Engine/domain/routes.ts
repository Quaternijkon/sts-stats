// @ts-nocheck
export const DATA_DETAIL_ROUTES = Object.freeze({
  card: 'cards',
  encounter: 'encounters',
  ancient: 'ancients',
  relic: 'relics'
});

export const DATA_ITEM_ROUTES = Object.freeze({
  ...DATA_DETAIL_ROUTES,
  run: 'runs',
  character: 'characters',
  build: 'builds',
  ascension: 'ascensions',
  outcome: 'outcomes',
  party: 'parties',
  gameMode: 'modes',
  floor: 'floors',
  act: 'acts',
  date: 'dates',
  week: 'weeks',
  playerPosition: 'player-positions',
  roomType: 'room-types'
});

export function parseDataDetailRoute(route) {
  const match = String(route || '').match(/^(card|encounter|ancient|relic)\/(.+)$/);
  if (!match) return null;
  return { kind: match[1], id: decodeURIComponent(match[2]) };
}

export function buildDataDetailRoute(kind, id) {
  if (!Object.hasOwn(DATA_DETAIL_ROUTES, kind)) return null;
  const value = String(id ?? '');
  if (!value) return null;
  return `${kind}/${encodeURIComponent(value)}`;
}

export function dataDetailHref(kind, id) {
  const route = buildDataDetailRoute(kind, id);
  return route ? `#/${route}` : '#/cards';
}

export function dataListRoute(kind) {
  return DATA_DETAIL_ROUTES[kind] || 'cards';
}

export function buildDataItemRoute(kind, id) {
  if (!Object.hasOwn(DATA_ITEM_ROUTES, kind)) return null;
  const value = String(id ?? '');
  return value ? `${DATA_ITEM_ROUTES[kind]}/${encodeURIComponent(value)}` : null;
}

export function parseDataItemRoute(route) {
  const match = String(route || '').match(/^([^/]+)\/(.+)$/);
  if (!match) return null;
  const kind = Object.entries(DATA_ITEM_ROUTES).find(([, path]) => path === match[1])?.[0];
  return kind ? { kind, id: decodeURIComponent(match[2]) } : null;
}
