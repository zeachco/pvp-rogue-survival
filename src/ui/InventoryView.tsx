/** @jsx h */
/** @jsxFrag Fragment */
import type { ItemInstance } from "../../common/items";
import { STAT_KEYS } from "../../common/progression";
import type { UnitBuild } from "../../common/protocol";
import { Fragment, h } from "./dom";
import type { HudCallbacks } from "./types";

export function itemCard(item: ItemInstance, actions: boolean, inspected: UnitBuild | undefined, callbacks: HudCallbacks, openItemMenuId: string | undefined, onMenuToggle: (itemId?: string) => void): HTMLElement {
  const bonuses = STAT_KEYS.filter((key) => item.statBonuses?.[key]).map((key) => `+${format(item.statBonuses?.[key] ?? 0)} ${capitalize(key)}`).join(" · ");
  const node = <div class={`item-card rarity-${item.rarity}`} title="Click for actions; right-click to equip"><strong>{item.name}</strong><small>L{item.level} {item.rarity} · {format(item.modifiers.damageMultiplier * 100)}% dmg · {format(item.modifiers.attackSpeedMultiplier * 100)}% spd{bonuses ? ` · ${bonuses}` : ""}</small></div> as HTMLElement;
  if (actions && !inspected) {
    const menu = <div class={`item-menu${openItemMenuId === item.id ? "" : " is-hidden"}`}><button type="button">Equip</button><button type="button">Sell {item.sellValue}g</button>{item.skills.length ? <button type="button">Extract {item.sellValue * 10}g</button> : null}</div> as HTMLElement;
    (menu.children[0] as HTMLButtonElement).onclick = (event) => { event.stopPropagation(); callbacks.onEquip(item.id); };
    (menu.children[1] as HTMLButtonElement).onclick = (event) => { event.stopPropagation(); callbacks.onSell(item.id); };
    if (item.skills.length) (menu.children[2] as HTMLButtonElement).onclick = (event) => { event.stopPropagation(); callbacks.onExtract(item.id); };
    node.append(menu); node.onclick = () => onMenuToggle(openItemMenuId === item.id ? undefined : item.id);
    node.oncontextmenu = (event) => { event.preventDefault(); callbacks.onEquip(item.id); };
  }
  return node;
}
function format(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function capitalize(value: string): string { return value[0].toUpperCase() + value.slice(1); }
