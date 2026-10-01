import type { ReactNode } from "react";
import type { TimelinePoint, NormalizedCard } from "../../../Engine/domain/types";
import type { ObjectKind } from "../../../Engine/domain/objectTypes";
import { zhEntity, zhMapType, zhRef } from "../../../Engine/domain/i18n";
import { Card } from "../../components/UI";
import { objectColor, formatValue } from "../../styles/theme";
import { useAppStore } from "../../state/appStore";
import { groupedCards, groupedIds, recordedValue } from "./replay";

const categories: Partial<Record<ObjectKind, string>> = {
  card: "cards", relic: "relics", potion: "potions", enchantment: "enchantments",
  ancient: "ancients", event: "events", encounter: "encounters",
};

export function InventoryChip({ kind, id, count, upgrade, allowsAnalysis, title, children }: {
  kind: ObjectKind;
  id: string;
  count?: number;
  upgrade?: number;
  allowsAnalysis: boolean;
  title?: string;
  children?: ReactNode;
}) {
  const openObject = useAppStore((state) => state.openObject);
  const label = zhEntity(id, categories[kind] ?? kind, id);
  const content = <>{children ?? label}{upgrade ? <span> +{upgrade}</span> : null}
    {count != null ? <strong> ×{count}</strong> : null}</>;
  const style = { color: objectColor(kind, id) };
  const help = title ? `${label} · ${title}` : label;
  return allowsAnalysis ?
    <button className="inventory-chip" style={style} title={help}
      onClick={() => openObject(kind, id)}>{content}</button> :
    <span className="inventory-chip" style={style} title={help}>{content}</span>;
}

export function InventoryIds({ ids, kind, allowsAnalysis }: {
  ids: string[]; kind: ObjectKind; allowsAnalysis: boolean;
}) {
  return <div className="inventory">{groupedIds(ids).map((item) =>
    <InventoryChip key={item.id} {...item} kind={kind} allowsAnalysis={allowsAnalysis} />)}
    {!ids.length && <span>无记录</span>}
  </div>;
}

export function InventoryCards({ cards, allowsAnalysis }: {
  cards: NormalizedCard[]; allowsAnalysis: boolean;
}) {
  return <div className="inventory">{groupedCards(cards).map((item) =>
    <InventoryChip key={JSON.stringify([item.id, item.upgrade])} {...item}
      kind="card" allowsAnalysis={allowsAnalysis} />)}
    {!cards.length && <span>无记录</span>}
  </div>;
}

export function NodeDetails({ point, allowsAnalysis }: {
  point: TimelinePoint; allowsAnalysis: boolean;
}) {
  const choices = (["cardChoices", "relicChoices", "potionChoices"] as const)
    .flatMap((field, kindIndex) => (point[field] ?? []).map((choice, index) => ({
      ...choice, key: `${field}/${index}`, kind: (["card", "relic", "potion"] as const)[kindIndex],
    })));
  const changes: { label: string; content: ReactNode }[] = [];
  const addIds = (label: string, ids: string[] | undefined, kind: ObjectKind) => {
    if (ids?.length) changes.push({ label, content:
      <InventoryIds ids={ids} kind={kind} allowsAnalysis={allowsAnalysis} /> });
  };
  const addCards = (label: string, cards: NormalizedCard[] | undefined) => {
    if (cards?.length) changes.push({ label, content:
      <InventoryCards cards={cards} allowsAnalysis={allowsAnalysis} /> });
  };
  addCards("获得卡牌", point.cardsGained);
  addCards("移除卡牌", point.cardsRemoved);
  addIds("升级卡牌", point.upgradedCards, "card");
  addIds("降级卡牌", point.downgradedCards, "card");
  addIds("获得遗物", point.relicsGained, "relic");
  addIds("移除遗物", point.relicsRemoved, "relic");
  addIds("购买遗物", point.boughtRelics, "relic");
  addIds("购买卡牌", point.boughtColorless, "card");
  addIds("获得药水", point.potionsGained, "potion");
  addIds("使用药水", point.potionsUsed, "potion");
  addIds("购买药水", point.potionsBought, "potion");
  addIds("丢弃药水", point.potionsDiscarded, "potion");
  const metrics = [
    ["hp", "生命"], ["maxHp", "最大生命"], ["hpLoss", "生命净减少"],
    ["hpGain", "生命净增加"], ["gold", "金币"], ["damageTaken", "承伤"],
    ["hpHealed", "回复"], ["goldGained", "获得金币"], ["goldSpent", "花费金币"],
    ["turns", "回合"],
  ].filter(([field]) => recordedValue(point, field) != null);
  const hasChoices = choices.length || point.eventChoices?.length || point.ancientChoices?.length;
  return <Card title={`${point.floor} · ${point.label}`} help="点击图表节点查看该处存档实际记录的指标与决策。">
    <dl className="details">
      <dt>房间</dt><dd>{zhMapType(point.type)} · 第 {point.act} 阶段 · {point.actFloor} 层</dd>
      <dt>节点指标</dt><dd>{metrics.map(([field, label]) =>
        `${label} ${formatValue(recordedValue(point, field))}`).join(" · ") || "—"}</dd>
      {!!hasChoices && <><dt>选择</dt><dd><div className="inventory">
        {choices.map((choice) => <InventoryChip key={choice.key} kind={choice.kind}
          id={choice.id} upgrade={choice.upgradeLevel} allowsAnalysis={allowsAnalysis}
          title={choice.picked ? "选取" : "跳过"}>
          {zhEntity(choice.id, categories[choice.kind], choice.id)} · {choice.picked ? "选取" : "跳过"}
        </InventoryChip>)}
        {(point.eventChoices ?? []).map((choice, index) =>
          <span className="inventory-chip" key={`event/${index}`} title={zhRef(choice.title)}>
            {zhRef(choice.title)}{choice.chosen === false ? " · 跳过" : ""}
          </span>)}
        {(point.ancientChoices ?? []).map((choice, index) =>
          <InventoryChip key={`ancient/${index}`} kind="relic" id={choice.relicId}
            allowsAnalysis={allowsAnalysis} title={choice.chosen ? "选取" : "跳过"}>
            {zhRef(choice.title)} · {choice.chosen ? "选取" : "跳过"}
          </InventoryChip>)}
      </div></dd></>}
      {changes.map((change) => <div key={change.label} style={{ display: "contents" }}>
        <dt>{change.label}</dt><dd>{change.content}</dd>
      </div>)}
      {!!point.cardsTransformed?.length && <><dt>转化卡牌</dt><dd className="inventory">
        {point.cardsTransformed.map((change, index) => <span className="inventory-chip" key={index}>
          {change.from ? zhEntity(change.from.id, "cards", change.from.id) : "—"}
          {" → "}{change.to ? zhEntity(change.to.id, "cards", change.to.id) : "—"}
        </span>)}
      </dd></>}
      {!!point.enchantedCards?.length && <><dt>附魔</dt><dd className="inventory">
        {point.enchantedCards.map((change, index) => <span className="inventory-chip" key={index}>
          {change.card ? zhEntity(change.card.id, "cards", change.card.id) : "—"} ·
          {" "}{zhEntity(change.enchantment, "enchantments", change.enchantment)}
          {change.amount != null ? ` ×${change.amount}` : ""}
        </span>)}
      </dd></>}
      {!!point.restChoices?.length && <><dt>休息选择</dt><dd className="inventory">
        {point.restChoices.map((choice, index) => <span className="inventory-chip" key={index}>
          {zhEntity(choice, "rest_site_ui", choice)}
        </span>)}
      </dd></>}
      {!!point.completedQuests?.length && <><dt>完成任务</dt><dd className="inventory">
        {point.completedQuests.map((quest, index) => <span className="inventory-chip" key={index}>
          {zhEntity(quest, "cards", quest)}
        </span>)}
      </dd></>}
    </dl>
  </Card>;
}
