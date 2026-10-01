import type { ObjectKind } from "../../Engine/domain/objectTypes";

/** Game terms follow the official v0.111.0 glossary; analytical labels stay shared. */
const labels: Record<ObjectKind, string> = {
  card: "卡牌", relic: "遗物", encounter: "遭遇战", ancient: "先古之民",
  potion: "药水", event: "事件", enemy: "敌人", enchantment: "附魔", quest: "任务",
  restChoice: "休息处选项", location: "地点", modifier: "特效", badge: "徽章",
  epoch: "纪元", achievement: "成就", character: "角色", build: "版本", ascension: "进阶",
  outcome: "结局", party: "队伍", gameMode: "游戏模式", floor: "楼层", act: "阶段",
  date: "日期", week: "周", playerPosition: "玩家位置", roomType: "房间类型",
};

export function objectKindLabel(kind: string): string {
  return labels[kind as ObjectKind] ?? kind;
}
