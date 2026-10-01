import type { NormalizedRunV2 } from './types.js';

export const OBJECT_CHARACTERS = ['Ironclad', 'Silent', 'Regent', 'Necrobinder', 'Defect', 'Watcher'] as const;
export type ObjectCharacter = typeof OBJECT_CHARACTERS[number];
export type ObjectPerspective = 'overall' | ObjectCharacter;

export function runsForObjectPerspective(runs: NormalizedRunV2[], perspective: ObjectPerspective): NormalizedRunV2[] {
  if (perspective === 'overall') return runs;
  return runs.filter((run) => run.character === perspective);
}

export function cardChoicePerspectiveRuns(runs: NormalizedRunV2[], perspective: ObjectPerspective = 'overall'): NormalizedRunV2[] {
  return runs.flatMap((run) => {
    const timelines = run.playerTimelines?.length ? run.playerTimelines : [run.timeline || []];
    return timelines.flatMap((timeline, playerIndex) => {
      const player = run.players[playerIndex] || run.players[0];
      const character = player?.character || run.character;
      if (perspective !== 'overall' && character !== perspective) return [];
      const cardChoices = timeline.flatMap((point) => {
        const choices = Array.isArray(point.cardChoices) ? point.cardChoices as Array<{ id?: unknown; picked?: unknown }> : [];
        if (!choices.length) return [];
        return choices.flatMap((choice) => {
          const id = String(choice.id || '');
          if (!id) return [];
          return [{ floor: Number(point.floor || 0), offered: [id], picked: Boolean(choice.picked) ? id : null }];
        });
      });
      if (!cardChoices.length && playerIndex > 0) return [];
      return [{
        ...run,
        id: `${run.id}:card-player-${playerIndex}`,
        originalRunId: run.id,
        sourceKey: `${run.sourceKey}:card-player-${playerIndex}`,
        character,
        players: player ? [player] : run.players,
        playerCount: 1,
        isMultiplayer: false,
        deck: player?.deck || run.deck,
        deckSize: player?.deck?.length || run.deckSize,
        relics: player?.relics || run.relics,
        relicCount: player?.relics?.length || run.relicCount,
        timeline,
        playerTimelines: [timeline],
        cardChoices: cardChoices.length ? cardChoices : run.cardChoices
      } as NormalizedRunV2];
    });
  });
}
