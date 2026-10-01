export type GameVersion = 'sts1' | 'sts2';

const GAME_CHARACTERS: Record<GameVersion, readonly string[]> = Object.freeze({
  sts1: Object.freeze(['Ironclad', 'Silent', 'Defect', 'Watcher']),
  sts2: Object.freeze(['Ironclad', 'Silent', 'Regent', 'Necrobinder', 'Defect'])
});

let currentGame: GameVersion = 'sts2';
let currentCharacters: readonly string[] = GAME_CHARACTERS.sts2;

export function setCurrentGame(value: unknown): GameVersion {
  currentGame = value === 'sts1' ? 'sts1' : 'sts2';
  currentCharacters = GAME_CHARACTERS[currentGame];
  return currentGame;
}

export function setGameCharacters(values: unknown[]): readonly string[] {
  const base = [...GAME_CHARACTERS[currentGame]];
  const seen = new Set(base);
  const extras = values.map(String).map((value) => value.trim())
    .filter((value) => value && value !== 'Unknown' && !seen.has(value));
  for (const value of extras) seen.add(value);
  const preferred = new Map(ALL_CHARACTERS.map((value, index) => [value, index]));
  currentCharacters = [...base, ...[...new Set(extras)].sort((left, right) => {
    const leftIndex = preferred.get(left) ?? 10_000;
    const rightIndex = preferred.get(right) ?? 10_000;
    return leftIndex - rightIndex || left.localeCompare(right);
  })];
  return currentCharacters;
}

export function gameVersion(): GameVersion { return currentGame; }

export function gameCharacters(): readonly string[] { return currentCharacters; }

export const ALL_CHARACTERS = Object.freeze(['Ironclad', 'Silent', 'Regent', 'Necrobinder', 'Defect', 'Watcher']);
