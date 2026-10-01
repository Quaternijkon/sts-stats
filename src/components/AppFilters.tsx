import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { useAppStore } from "../state/appStore";
import type { FilterSpec } from "../services/models";
import { zhCharacter, zhGameMode, zhStatus } from "../../Engine/domain/i18n";
import { activeFilterTokens, dateRangePreset, parseObjectIDs, removeFilterPatch } from "../services/filters";

const multipleValue = "__multiple";
const outcomes: FilterSpec["outcomes"] = ["win", "loss", "abandoned"];

function ObjectIDsInput({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  const serialized = values.join(", ");
  const [draft, setDraft] = useState(serialized);
  useEffect(() => setDraft(serialized), [serialized]);
  return <label>{label}<input value={draft} onChange={(event) => setDraft(event.target.value)}
    onBlur={() => onChange(parseObjectIDs(draft))}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
    title="多个 ID 用逗号分隔；按回车或离开输入框应用" /></label>;
}

function ChoiceSet<T extends string | number>({ title, options, selected, label, onChange }: {
  title: string; options: T[]; selected: T[]; label: (value: T) => string; onChange: (values: T[]) => void;
}) {
  return <fieldset><legend>{title}</legend>
    {options.map((value) => <label key={value}><input type="checkbox" checked={selected.includes(value)}
      onChange={(event) => onChange(event.target.checked ? [...selected, value] : selected.filter((item) => item !== value))} />{label(value)}</label>)}
  </fieldset>;
}

export function AppFilters() {
  const { filter, setFilter, resetFilter, characters, dataset } = useAppStore();
  const [expanded, setExpanded] = useState(false);
  const [multi, setMulti] = useState(false);
  const tokens = activeFilterTokens(filter);
  const options = useMemo(() => ({
    builds: [...new Set([...dataset.runs.map((run) => run.buildId).filter(Boolean), ...filter.builds])].sort(),
    ascensions: [...new Set([...Array.from({ length: 11 }, (_, index) => index), ...dataset.runs.map((run) => run.ascension), ...filter.ascensions])].sort((a, b) => a - b),
    modes: [...new Set([...dataset.runs.map((run) => run.gameMode).filter(Boolean), ...filter.mode])].sort(),
  }), [dataset.runs, filter.builds, filter.ascensions, filter.mode]);
  const selection = (values: (string | number)[]) => values.length > 1 ? multipleValue : values[0] ?? "";
  const multipleOption = (values: (string | number)[]) => values.length > 1
    ? <option value={multipleValue} disabled>{values.length} 项已选</option> : null;
  return <div className="filters">
    <div className="filter-primary">
      <label>角色<select value={selection(filter.characters)} onChange={(event) => setFilter({ characters: event.target.value ? [event.target.value] : [] })}>
        <option value="">全部角色</option>{multipleOption(filter.characters)}
        {[...new Set([...characters, ...filter.characters])].map((value) => <option key={value} value={value}>{zhCharacter(value)}</option>)}
      </select></label>
      <label>进阶<select value={selection(filter.ascensions)} onChange={(event) => setFilter({ ascensions: event.target.value === "" ? [] : [Number(event.target.value)] })}>
        <option value="">全部</option>{multipleOption(filter.ascensions)}
        {options.ascensions.map((value) => <option key={value} value={value}>A{value}</option>)}
      </select></label>
      <label>结果<select value={selection(filter.outcomes)} onChange={(event) => setFilter({ outcomes: event.target.value ? [event.target.value as FilterSpec["outcomes"][number]] : [] })}>
        <option value="">全部</option>{multipleOption(filter.outcomes)}
        {(["win", "loss", "abandoned"] as const).map((value) => <option key={value} value={value}>{zhStatus(value)}</option>)}
      </select></label>
      <label>从<input type="date" value={filter.dateFrom ?? ""} max={filter.dateTo ?? undefined} onChange={(event) => setFilter({ dateFrom: event.target.value || null })} /></label>
      <label>至<input type="date" value={filter.dateTo ?? ""} min={filter.dateFrom ?? undefined} onChange={(event) => setFilter({ dateTo: event.target.value || null })} /></label>
      <details className="date-presets"><summary>时间范围</summary><div className="action-row">
        <button onClick={() => setFilter(dateRangePreset(null))}>所有时间</button>
        <button onClick={() => setFilter(dateRangePreset(30))}>近 30 天</button>
        <button onClick={() => setFilter(dateRangePreset(90))}>近 90 天</button>
      </div></details>
      <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded}><Search size={15} />更多</button>
      <button onClick={() => setMulti(!multi)} aria-expanded={multi}>多选</button>
      <button onClick={resetFilter} disabled={!tokens.length}>重置</button>
    </div>
    {expanded && <div className="filter-extra">
      <label>版本<select value={selection(filter.builds)} onChange={(event) => setFilter({ builds: event.target.value ? [event.target.value] : [] })}>
        <option value="">全部版本</option>{multipleOption(filter.builds)}{options.builds.map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <label>模式<select value={selection(filter.mode)} onChange={(event) => setFilter({ mode: event.target.value ? [event.target.value] : [] })}>
        <option value="">全部</option>{multipleOption(filter.mode)}{options.modes.map((value) => <option key={value} value={value}>{zhGameMode(value)}</option>)}
      </select></label>
      <label>放弃记录<select value={filter.abandonPolicy ?? "include"} onChange={(event) => setFilter({ abandonPolicy: event.target.value as FilterSpec["abandonPolicy"] })}>
        <option value="include">包含</option><option value="exclude-all">全部排除</option><option value="exclude-short">排除短局</option>
      </select></label>
      {filter.abandonPolicy === "exclude-short" && <label>短局分钟<input type="number" min="1" max="1440" value={filter.shortAbandonMinutes ?? 5}
        onChange={(event) => setFilter({ shortAbandonMinutes: Math.max(1, Math.min(1440, Number(event.target.value) || 5)) })} /></label>}
      {(["minDuration", "maxDuration"] as const).map((key, index) => <label key={key}>{index === 0 ? "最短分钟" : "最长分钟"}
        <input type="number" min="0" value={filter[key] == null ? "" : filter[key]! / 60}
          onChange={(event) => setFilter({ [key]: event.target.value === "" ? null : Math.max(0, Number(event.target.value)) * 60 })} />
      </label>)}
      {(["includeCards", "excludeCards", "includeRelics", "excludeRelics"] as const).map((key, index) =>
        <ObjectIDsInput key={key} label={["包含卡牌 ID", "排除卡牌 ID", "包含遗物 ID", "排除遗物 ID"][index]} values={filter[key]} onChange={(values) => setFilter({ [key]: values })} />)}
    </div>}
    {multi && <div className="filter-multi">
      <ChoiceSet title="多选角色" options={characters} selected={filter.characters} label={zhCharacter} onChange={(characters) => setFilter({ characters })} />
      <ChoiceSet title="多选进阶" options={options.ascensions} selected={filter.ascensions} label={(value) => `A${value}`} onChange={(ascensions) => setFilter({ ascensions })} />
      <ChoiceSet title="多选结果" options={outcomes} selected={filter.outcomes} label={zhStatus} onChange={(outcomes) => setFilter({ outcomes })} />
      <ChoiceSet title="多选版本" options={options.builds} selected={filter.builds} label={String} onChange={(builds) => setFilter({ builds })} />
      <ChoiceSet title="多选模式" options={options.modes} selected={filter.mode} label={zhGameMode} onChange={(mode) => setFilter({ mode })} />
    </div>}
    {tokens.length > 0 && <div className="filter-tokens" aria-label="已选条件">
      {tokens.map((token) => <button key={token.key} className="filter-token" onClick={() => setFilter(removeFilterPatch(token.key))}
        title={`移除筛选：${token.title}`} aria-label={`移除筛选：${token.title}`}>{token.title}<X size={13} /></button>)}
    </div>}
  </div>;
}
