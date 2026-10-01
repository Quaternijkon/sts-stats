import { useEffect, useMemo, useState } from "react";
import { Card, NumericColumnScale, ObjectNumericCell } from "../../components/UI";
import { zhCharacter } from "../../../Engine/domain/i18n";
import { characterColor, formatValue } from "../../styles/theme";
import type { CharacterSummary } from "./helpers";

const columns = [
  { id: "character", label: "角色" },
  { id: "total", label: "对局" },
  { id: "wins", label: "胜利" },
  { id: "losses", label: "失败" },
  { id: "abandoned", label: "放弃" },
  { id: "winRate", label: "胜率", format: "percent", help: "胜利局数 ÷ 非放弃局数" },
  { id: "highestAscension", label: "最高进阶" },
  { id: "maxWinStreak", label: "最佳连胜", help: "失败和放弃都会中断连胜" },
  { id: "avgFloor", label: "平均楼层" },
  { id: "avgTime", label: "平均时长", format: "duration" },
] as const;
type ColumnID = (typeof columns)[number]["id"];
type NumericColumnID = Exclude<ColumnID, "character">;

function metricValue(row: CharacterSummary, column: NumericColumnID): number | null {
  return !row.total || ((column === "winRate" || column.startsWith("avg")) && !row.completed) ? null : row[column];
}

export function CharacterRecords({ rows, career }: { rows: CharacterSummary[]; career: boolean }) {
  const [sort, setSort] = useState<{ column: ColumnID; descending: boolean }>({ column: career ? "wins" : "character", descending: career });
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  useEffect(() => {
    setSort({ column: career ? "wins" : "character", descending: career });
    setSelected(null);
    setPage(0);
  }, [career]);
  const values = useMemo(() => {
    const scales = new Map(columns.filter((column) => column.id !== "character").map((column) => [column.id,
      new NumericColumnScale(rows.map((row) => metricValue(row, column.id as NumericColumnID)))] as const));
    return rows.map((row) => ({ row, scales: new Map([...scales].map(([id, scale]) => {
      const value = metricValue(row, id as NumericColumnID);
      return [id, { fill: scale.fraction(value) ?? 0, heat: scale.intensity(value) ?? 0 }] as const;
    })) }));
  }, [rows]);
  const sorted = useMemo(() => [...values].sort((a, b) => {
    const column = sort.column;
    let comparison: number;
    if (column === "character") comparison = zhCharacter(a.row.character).localeCompare(zhCharacter(b.row.character), "zh-CN");
    else {
      const left = metricValue(a.row, column);
      const right = metricValue(b.row, column);
      if (left == null || right == null) return (left == null ? right == null ? 0 : 1 : -1) || a.row.character.localeCompare(b.row.character);
      comparison = left - right;
    }
    return (sort.descending ? -comparison : comparison) || a.row.character.localeCompare(b.row.character);
  }), [values, sort]);
  const lastPage = Math.max(0, Math.ceil(sorted.length / 50) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = sorted.slice(currentPage * 50, (currentPage + 1) * 50);
  const selectedRow = rows.find((row) => row.character === selected);
  return <Card title={career ? "角色记录" : "角色统计"} help={career ? "已导入的全部单人记录累计，不受页面筛选影响。点击角色查看完整记录。" : "当前筛选下的单人记录。点击角色查看完整记录。"}>
    <div className="table-scroll overview-character-table">
      <table>
        <thead><tr>{columns.map((column) => <th key={column.id} aria-sort={sort.column === column.id ? sort.descending ? "descending" : "ascending" : "none"}>
          <button title={"help" in column ? column.help : `按${column.label}排序`} onClick={() => {
            setSort({ column: column.id, descending: sort.column === column.id ? !sort.descending : column.id !== "character" });
            setPage(0);
          }}>{column.label}{sort.column === column.id ? sort.descending ? " ↓" : " ↑" : ""}</button>
        </th>)}</tr></thead>
        <tbody>{visible.map(({ row, scales }) => <tr key={row.character} aria-selected={selected === row.character}>
          {columns.map((column) => <td key={column.id}>
            {column.id === "character" ? <button className="overview-character-name" style={{ color: characterColor(row.character) }}
              aria-expanded={selected === row.character} onClick={() => setSelected(selected === row.character ? null : row.character)}>{zhCharacter(row.character)}</button>
              : <ObjectNumericCell value={metricValue(row, column.id)}
                fill={scales.get(column.id)?.fill ?? 0} heat={scales.get(column.id)?.heat ?? 0}
                semantic={column.id === "winRate" ? "rate" : "number"}
                format={"format" in column ? column.format : "number"}
                help={column.id === "winRate" ? `${row.wins} 胜 / ${row.completed} 局` : "help" in column ? column.help : column.label} />}
          </td>)}
        </tr>)}</tbody>
      </table>
    </div>
    {lastPage > 0 && <div className="overview-table-pagination">
      <button onClick={() => setPage(currentPage - 1)} disabled={currentPage === 0}>上一页</button>
      <span>{currentPage + 1} / {lastPage + 1}</span>
      <button onClick={() => setPage(currentPage + 1)} disabled={currentPage === lastPage}>下一页</button>
    </div>}
    {selectedRow && <details className="overview-character-record" open>
      <summary style={{ color: characterColor(selectedRow.character) }}>{zhCharacter(selectedRow.character)} · 完整角色记录</summary>
      <dl className="details">
        <dt>已完成</dt><dd>{formatValue(selectedRow.completed)}</dd>
        <dt>当前连胜</dt><dd>{formatValue(selectedRow.currentStreak)}</dd>
        <dt>平均牌组</dt><dd>{selectedRow.completed ? formatValue(selectedRow.avgDeck) : "—"}</dd>
        <dt>平均承伤</dt><dd>{formatValue(selectedRow.avgDamageTaken)}</dd>
        <dt>胜利最少卡牌数</dt><dd>{formatValue(selectedRow.minWinningDeckSize)}</dd>
        <dt>胜利最多卡牌数</dt><dd>{formatValue(selectedRow.maxWinningDeckSize)}</dd>
      </dl>
      <details><summary>完整统计数据</summary><pre>{JSON.stringify(selectedRow, null, 2)}</pre></details>
    </details>}
  </Card>;
}
