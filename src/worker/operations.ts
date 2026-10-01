import type { Dataset } from "../services/models";

export interface StorageSummary {
  soloRuns: number;
  coopRuns: number;
  totalRuns: number;
  soloTime: number;
  coopTime: number;
  totalTime: number;
  progressTime: number | null;
  progressRecordedRuns: number | null;
}

export function storageSummary(dataset: Dataset): StorageSummary {
  const solo = dataset.runs.filter(
    (run) => !run.isMultiplayer && run.playerCount <= 1 && run.players.length <= 1,
  );
  const soloIds = new Set(solo.map((run) => run.id));
  const coop = dataset.runs.filter((run) => !soloIds.has(run.id));
  const duration = (runs: Dataset["runs"]) =>
    runs.reduce(
      (sum, run) => sum + (Number.isFinite(run.runTime) ? run.runTime : 0),
      0,
    );
  const soloTime = duration(solo);
  const coopTime = duration(coop);
  const progress = dataset.progress;
  const characters = progress?.characterStats ?? [];
  let progressRecordedRuns: number | null = characters.length ? 0 : null;
  for (const character of characters) {
    for (const key of ["wins", "losses"] as const) {
      const value = character[key];
      if (
        (Array.isArray(character.recordedFields) && !character.recordedFields.includes(key)) ||
        typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 ||
        progressRecordedRuns === null || !Number.isSafeInteger(progressRecordedRuns + value)
      ) {
        progressRecordedRuns = null;
        break;
      }
      progressRecordedRuns += value;
    }
    if (progressRecordedRuns === null) break;
  }
  const progressTime = progress?.totalPlaytime;
  return {
    soloRuns: solo.length,
    coopRuns: coop.length,
    totalRuns: dataset.runs.length,
    soloTime,
    coopTime,
    totalTime: soloTime + coopTime,
    progressTime: (!progress?.recordedFields || progress.recordedFields.includes("totalPlaytime")) &&
      typeof progressTime === "number" && Number.isFinite(progressTime) ? progressTime : null,
    progressRecordedRuns,
  };
}
