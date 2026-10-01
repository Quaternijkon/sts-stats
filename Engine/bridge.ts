import { CARD_POOL_CACHE_VERSION, readCardPoolCache } from './domain/cardPools';
import type { CardPool } from './domain/cardPools';
import * as parser from './domain/parser';
import * as analytics from './domain/analytics';
import { executeQuery, executeCareerQuery, exportAnalysisCsv, matchesFilter, METRICS, DIMENSIONS } from './domain/query';
import { EMPTY_FILTER, validateNormalizedRun, validateCareerProgress, validateQuery } from './domain/schemas';
import { analyzePreferenceArenaRuns } from './domain/preferenceArena';
import { analyzeCardArchetypes } from './domain/cardArchetypes';
import { analyzeRestSites } from './domain/restSiteAnalysis';
import { legacyEntityProfile, legacyAncients, legacyAncient } from './domain/objectLegacy';
import { runMatchesDataItem } from './domain/dataItems';
import { zhEntity, zhCharacter } from './domain/i18n';
import { UnifiedObjectRegistry } from './domain/objectAnalysis';
import { OBJECT_KINDS } from './domain/objectTypes';
import type { CareerProgress, NormalizedRunV2 } from './domain/types';
import { setCurrentGame, setGameCharacters } from './domain/game';
let runs:NormalizedRunV2[] = [];
let progress: CareerProgress | null = null;
let objectRegistry: UnifiedObjectRegistry | null = null;
let cardPools: ReadonlyMap<string, CardPool> | null = null;

function objects(): UnifiedObjectRegistry {
  if (!objectRegistry) {
    objectRegistry = new UnifiedObjectRegistry(runs, progress, cardPools ?? undefined);
    cardPools = objectRegistry.cardPools;
  }
  return objectRegistry;
}

function isCoop(run:any): boolean {
  return run.isMultiplayer || run.playerCount > 1 || run.players.length > 1;
}
export function dispatch(input:string): string {
  const p = JSON.parse(input);
  let selected = ['load', 'parse', 'catalog', 'run', 'csv', 'label', 'objects', 'object', 'cardPoolCache'].includes(p.op) ? [] : runs.filter(r=> isCoop(r) === (p.op === 'coop') && matchesFilter(r, {...EMPTY_FILTER, ...p.filter, party:'all'}));
  if(p.focus) selected = selected.filter(r=>runMatchesDataItem(r,p.focus));
  let result:any;
  switch(p.op) {
    case 'load': {
      setCurrentGame(p.game);
      const nextRuns = p.runs.map(validateNormalizedRun);
      const nextProgress = p.progress == null ? null : validateCareerProgress(p.progress);
      setGameCharacters([
        ...nextRuns.flatMap((run:any) => [run.character, ...(run.players || []).map((player:any) => player.character)]),
        ...(nextProgress?.characterStats || []).map((row:any) => row.character)
      ]);
      runs = nextRuns; progress = nextProgress; objectRegistry = null; cardPools = null;
      result = {count:runs.length}; break;
    }
    case 'cardPoolCache': {
      const restored = readCardPoolCache(p.cache);
      const reused = restored !== null || cardPools !== null;
      if (restored && !cardPools) { cardPools = restored; objectRegistry = null; }
      if (!cardPools) objects();
      result = { reused, cache: { version: CARD_POOL_CACHE_VERSION, assignments: Object.fromEntries(cardPools!) } };
      break;
    }
    case 'parse': {
      setCurrentGame(p.game);
      result=p.files.map((f:any)=> f.name.toLowerCase().endsWith('.run') ? {run:validateNormalizedRun(parser.parseRunText(f.text,f.name,p.game))} : {progress:validateCareerProgress(parser.parseProgressText(f.text))}); break;
    }
    case 'objects':
    case 'object': {
      if (!OBJECT_KINDS.includes(p.kind)) throw Error('未知对象类别 ' + p.kind);
      result = p.op === 'objects' ? objects().objects(p) : objects().object(p); break;
    }
    case 'catalog': result={metrics:METRICS, dimensions:DIMENSIONS, filter:EMPTY_FILTER}; break;
    case 'query': { const q=validateQuery({...p.query, filter:{...EMPTY_FILTER,...p.query?.filter,...p.filter,party:'solo'}}); result=q.dataSource==='career'?executeCareerQuery(selected,q):executeQuery(selected,q); break; }
    case 'dashboard': result={summary:analytics.summarizeRuns(selected),characters:analytics.characterStats(selected),rolling:analytics.rollingWinRate(selected),survival:analytics.survivalByFloor(selected),rest:analytics.restSiteStats(selected),ascensions:analytics.ascensionStats(selected),history:analytics.dashboardHistory(selected),playtime:analytics.dashboardPlaytime(selected,p.activityDays)}; break;
    case 'restAnalysis': result=analyzeRestSites(selected); break;
    case 'runs': result=selected.sort((a,b)=>b.startTime-a.startTime).map(({raw,map,timeline,playerTimelines,...r})=>r); break;
    case 'run': {const r=runs.find(r=>r.id===p.id); if(!r) throw Error('未找到对局'); result={...r,players:r.players.map(player=>({...player,deck:player.deck.map(c=>({...c,label:zhEntity(c.id,'cards',c.id)})),relics:player.relics.map(c=>({...c,label:zhEntity(c.id,'relics',c.id)}))})),timeline:parser.buildPlayerTimeline(r,p.player||0)};break;}
    case 'coop': {const pool=selected; const groups=new Map<string,NormalizedRunV2[]>();const telemetry:any[]=[];for(const r of pool){const key=r.players.map(p=>zhCharacter(p.character)).sort().join(' + ');if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(r);r.players.forEach((player,index)=>{const points: any[]=r.playerTimelines?.[index]||parser.buildPlayerTimeline(r,index);telemetry.push({id:r.id+':'+index,runId:r.id,character:zhCharacter(player.character),position:index+1,lowHpNodes:points.filter(p=>p.maxHp>0&&p.hp/p.maxHp<.25).length,nodes:points.length,damage:points.reduce((n,p)=>n+p.damageTaken,0),healed:points.reduce((n,p)=>n+p.hpHealed,0)});});}result={runs:pool.map(({raw,map,timeline,playerTimelines,...r})=>r),telemetry,compositions:[...groups].map(([label,rs])=>({id:label,label,sample:rs.length,winRate:analytics.ratio(rs.filter(r=>r.win).length,rs.filter(r=>r.status!=='abandoned').length)}))};break;}
    case 'arena': result=analyzePreferenceArenaRuns(selected,p.scope||{}); break;
    case 'archetypes': result=analyzeCardArchetypes(selected,p.character||'Ironclad'); break;
    case 'entity': result=legacyEntityProfile(selected,p.kind,p.id,p.perspective);break;
    case 'ancients': result=legacyAncients(selected);break;
    case 'ancient': result=legacyAncient(selected,p.id,p.perspective);break;
    case 'career': result=analytics.careerFromRuns(runs.filter(r=>!isCoop(r)));break;
    case 'csv': result=exportAnalysisCsv(p.result);break;
    case 'label': result=zhEntity(p.id,p.kind,p.id);break;
    default: throw Error('未知操作 '+p.op);
  }
  return JSON.stringify(result??null);
}
