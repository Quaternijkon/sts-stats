import { useEffect, useMemo, useRef, useState } from "react";
import { formatValue, numericColor } from "../../styles/theme";
import { activityWeeks, activityYears, localDateKey, type ActivityDay, type OverviewData } from "./helpers";

export function useLocalToday() {
  const [today, setToday] = useState(() => new Date());
  const date = localDateKey(today);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      const now = new Date();
      setToday((previous) => localDateKey(previous) === localDateKey(now) ? previous : now);
      clearTimeout(timer);
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(update, Math.max(1000, next.valueOf() - now.valueOf() + 100));
    };
    update();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [date]);
  return today;
}

export function ActivityCalendar({ playtime, days, today, year, onYearChange }: {
  playtime: OverviewData["playtime"];
  days: ActivityDay[];
  today: Date;
  year: number;
  onYearChange: (year: number) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const weeks = useMemo(() => activityWeeks(days), [days]);
  const values = useMemo(() => new Map((playtime?.days ?? []).map((day) => [day.date, day])), [playtime]);
  const years = activityYears(playtime?.firstStartTime, today, year);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollLeft = scroll.current.scrollWidth;
  }, [days]);
  return (
    <div className="overview-activity">
      <div className="overview-activity-heading">
        <strong title="按本地自然日累计游戏时间，跨午夜的对局分配到对应日期。">
          {formatValue(playtime?.totalSeconds ?? 0, "duration")}
        </strong>
        <label>
          <span className="sr-only">游戏投入时间年份</span>
          <select aria-label="游戏投入时间年份" value={year} onChange={(event) => onYearChange(Number(event.target.value))}>
            <option value={0}>最近一年</option>
            {years.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <div className="overview-calendar-scroll" ref={scroll}>
        <div className="overview-calendar" role="group" aria-label={year ? `${year} 年游戏投入时间` : "最近一年游戏投入时间"}>
          <div className="overview-weekdays" aria-hidden="true">
            <span />
            {Array.from({ length: 7 }, (_, index) => <span key={index}>{({ 1: "周一", 3: "周三", 5: "周五" } as Record<number, string>)[index] ?? ""}</span>)}
          </div>
          {weeks.map((week, index) => {
            const first = week.find((day) => day && new Date(day.startTime * 1000).getDate() === 1)
              ?? (index === 0 && week.find((day) => day && new Date(day.startTime * 1000).getDate() <= 15));
            return <div className="overview-calendar-week" key={week.find((day) => day)?.date ?? index}>
              <span className="overview-month" aria-hidden="true">{first ? `${new Date(first.startTime * 1000).getMonth() + 1}月` : ""}</span>
              {week.map((day, row) => {
                if (!day) return <span key={`empty-${row}`} className="overview-calendar-day empty" aria-hidden="true" />;
                const value = values.get(day.date);
                const seconds = value?.seconds ?? 0;
                const elapsed = seconds < 60 ? `${Math.floor(Math.max(0, seconds))} 秒` : formatValue(seconds, "duration");
                const help = `${day.date} · ${elapsed} · 百分位 ${formatValue(value?.percentile, "percent")} · ${value?.runCount ?? 0} 局`;
                return <span key={day.date} className="overview-calendar-day" tabIndex={0} role="img" aria-label={help} title={help}
                  style={{ background: seconds ? numericColor(value?.percentile ?? 0) : "var(--inset)", opacity: seconds ? 0.45 + (value?.level ?? 1) * 0.13 : 1 }} />;
              })}
            </div>;
          })}
        </div>
      </div>
      <div className="overview-calendar-legend" aria-label="游戏时长色阶：蓝色较少，青色居中，橙色较多，只表示时长大小。">
        <span title={`${playtime?.totalRuns ?? 0} 局在所选日期范围内记录了游戏时间。`}>{playtime?.activeDays ?? 0} 个活跃日</span>
        <span>少</span>
        <i style={{ background: "var(--inset)" }} />
        {[0, 0.33, 0.67, 1].map((value) => <i key={value} style={{ background: numericColor(value) }} />)}
        <span>多</span>
      </div>
    </div>
  );
}
