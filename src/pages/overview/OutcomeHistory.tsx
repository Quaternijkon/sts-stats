import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "../../components/UI";
import { useAppStore } from "../../state/appStore";
import { zhCharacter } from "../../../Engine/domain/i18n";
import { characterColor, formatValue } from "../../styles/theme";
import { outcomeLayout, type OutcomeGroup, type OverviewData } from "./helpers";

function OutcomeHistoryGroup({ group }: { group: OutcomeGroup }) {
  const container = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(280);
  const [scrollColumn, setScrollColumn] = useState(Number.POSITIVE_INFINITY);
  const openRun = useAppStore((state) => state.openRun);
  const layout = useMemo(() => outcomeLayout(width, group.items.length), [width, group.items.length]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (grid.current) grid.current.scrollLeft = grid.current.scrollWidth;
  }, [layout.columns, layout.cellSize, group.items]);
  const virtual = group.items.length > 500;
  const firstColumn = Math.max(0, Math.min(layout.columns - layout.visibleColumns, scrollColumn) - 2);
  const lastColumn = Math.min(layout.columns, firstColumn + layout.visibleColumns + 4);
  const firstSlot = virtual ? firstColumn * 5 : 0;
  const lastSlot = virtual ? lastColumn * 5 : layout.columns * 5;
  const slots = Array.from({ length: lastSlot - firstSlot }, (_, index) => {
    const slot = firstSlot + index;
    const placement = virtual ? { gridColumn: Math.floor(slot / 5) + 1, gridRow: slot % 5 + 1 } : {};
    const entry = group.items[slot - layout.padding];
    if (!entry) return <span className="overview-outcome-empty" key={`empty-${slot}`} style={placement} aria-hidden="true" />;
    const result = entry.status === "win" ? "胜利" : entry.status === "loss" ? "失败" : "放弃";
    const help = `${formatValue(entry.startTime, "date")} · ${zhCharacter(entry.character)}\n${result} · 进阶 ${entry.ascension} · ${formatValue(entry.runTime, "duration")}`;
    return <button key={entry.id} onClick={() => openRun(entry.id)} aria-label={help} title={help}
      style={{ ...placement, width: layout.cellSize, height: layout.cellSize, background: entry.status === "win" ? "var(--success)" : entry.status === "loss" ? "var(--damage)" : "var(--muted)" }} />;
  });
  return <div className="history-group overview-history-group" ref={container}>
    <h3 style={{ color: group.id === "all" ? "var(--text)" : characterColor(group.id) }}>
      <span title={group.id === "all" ? "总体" : zhCharacter(group.id)}>{group.id === "all" ? "总体" : zhCharacter(group.id)}</span>
      <small title={`${group.total} 局`}>{group.wins} 胜 {group.losses} 负 {group.abandoned} 弃</small>
    </h3>
    <div className={`history-grid overview-history-grid${virtual ? " overview-history-virtual" : ""}`} ref={grid} tabIndex={0} aria-label={`${group.id === "all" ? "总体" : zhCharacter(group.id)}胜负记录，最新记录位于右下角`}
      onScroll={virtual ? (event) => {
        const next = Math.floor(event.currentTarget.scrollLeft / (layout.cellSize + 4));
        setScrollColumn((current) => current === next ? current : next);
      } : undefined}
      style={{ gridTemplateRows: `repeat(5, ${layout.cellSize}px)`, gridAutoColumns: `${layout.cellSize}px` }}>
      {virtual ? <div className="overview-history-track" style={{ gridTemplateRows: `repeat(5, ${layout.cellSize}px)`, gridTemplateColumns: `repeat(${layout.columns}, ${layout.cellSize}px)`, width: layout.columns * (layout.cellSize + 4) - 4 }}>{slots}</div> : slots}
    </div>
  </div>;
}

export function OutcomeHistory({ history }: { history: OverviewData["history"] }) {
  const characters = useAppStore((state) => state.characters);
  const groups = useMemo(() => {
    if (!history) return [];
    const byCharacter = new Map(history.characters.map((group) => [group.id, group]));
    return [history.overall, ...characters.map((id) => byCharacter.get(id) ?? { id, total: 0, wins: 0, losses: 0, abandoned: 0, items: [] }),
      ...history.characters.filter((group) => !characters.includes(group.id))];
  }, [history, characters]);
  return <Card title="胜负记录" help="胜利绿色、失败红色、放弃灰色。每列从上到下，再从左到右按时间排列；右下角为最新记录，横向滚动保留全部记录。">
    <div className="history-groups">{groups.map((group) => <OutcomeHistoryGroup key={group.id} group={group} />)}</div>
  </Card>;
}
