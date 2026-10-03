import type { Dataset, DatasetSummary } from "./models";

export function datasetSummary(dataset: Dataset): DatasetSummary {
  const progress = dataset.progress;
  return {
    source: dataset.source, importedAt: dataset.importedAt,
    runs: dataset.runs.map((run) => ({
      id: run.id, fileName: run.fileName, character: run.character,
      ascension: run.ascension, status: run.status, floor: run.floor,
      runTime: run.runTime, startTime: run.startTime, playerCount: run.playerCount,
      isMultiplayer: run.isMultiplayer, buildId: run.buildId, gameMode: run.gameMode,
      players: run.players.map(({ id, character }) => ({ id, character })),
    })),
    progress: progress ? {
      ...(progress.totalPlaytime != null ? { totalPlaytime: progress.totalPlaytime } : {}),
      ...(progress.recordedFields ? { recordedFields: progress.recordedFields } : {}),
      characterStats: (progress.characterStats ?? []).map((row) => ({
        character: row.character,
        ...(row.wins != null ? { wins: row.wins } : {}),
        ...(row.losses != null ? { losses: row.losses } : {}),
        ...(row.recordedFields ? { recordedFields: row.recordedFields } : {}),
      })),
    } : null,
  };
}
