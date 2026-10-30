import { capitalize } from "../../common/format";
import type { ItemInstance } from "../../common/items";
import type { PlayerProgress, UnitBuild } from "../../common/protocol";
import type { Stats } from "../../common/progression";
import type { CreepTimedStates } from "../game/types";
import { effectTimeLabel, statusEffectSummaries } from "./HeroResourceDock";
import { bindRequirementPreview, itemDetails } from "./ItemDetails";
import { formatProjectedValue } from "./preview";
import { h } from "./dom";

export function equipmentIcon(
	item: ItemInstance | undefined,
	slot: string,
): HTMLElement {
	const glyph = !item
		? "—"
		: item.itemKind === "weapon"
			? "⚔"
			: item.itemKind === "buckler"
				? "◆"
				: item.itemKind === "relic"
					? "✦"
					: item.itemKind === "amulet"
						? "◉"
						: "◇";
	const label = `${slot}: ${item?.name ?? "Empty"}`;
	return (
		<span
			class={`equipped-icon${item ? ` rarity-${item.rarity}` : " is-empty"}`}
			tabindex="0"
			aria-label={label}
		>
			{glyph}
			<span role="tooltip">{label}</span>
		</span>
	) as HTMLElement;
}

export function inspectedEquipment(
	build: UnitBuild | undefined,
	progress: Pick<PlayerProgress, "mainHand" | "offHand" | "amulet" | "charm">,
): [
	ItemInstance | undefined,
	ItemInstance | undefined,
	ItemInstance | undefined,
	ItemInstance | undefined,
] {
	const owner = build ?? progress;
	return [owner.mainHand, owner.offHand, owner.amulet, owner.charm];
}

export function equipmentSummary(
	item: ItemInstance | undefined,
	stats: Stats,
	slot: "main" | "off",
	baselineItem?: ItemInstance,
	baselineStats?: Stats,
): HTMLElement {
	if (!item)
		return (
			<div class={`item-card equipped-item equipped-${slot}-hand is-empty`}>
				<strong>Unarmed</strong>
				<small>1H · no weapon</small>
			</div>
		) as HTMLElement;
	const node = (
		<div
			class={`item-card equipped-item equipped-${slot}-hand rarity-${item.rarity}`}
			style={slot === "main" ? "--attack-progress:100%" : undefined}
		>
			<span class="tile-text-anchor item-name-anchor" tabindex="0">
				<strong>{item.name}</strong>
				<span class="tile-text-tooltip" role="tooltip">
					{item.name}
				</span>
			</span>
			<small
				class={
					baselineItem && baselineItem.level !== item.level
						? "is-gain-preview"
						: ""
				}
			>
				Level{" "}
				{formatProjectedValue({
					currentVal: baselineItem?.level ?? item.level,
					newVal: item.level,
				})}{" "}
				·{" "}
				{item.itemKind === "weapon"
					? `${item.hands}-handed`
					: capitalize(item.itemKind)}{" "}
				· {item.rarity}
			</small>
			{itemDetails(item, stats, baselineItem, baselineStats)}
		</div>
	) as HTMLElement;
	bindRequirementPreview(
		node.querySelector<HTMLElement>(".equipment-details")!,
		item,
		stats,
	);
	return node;
}

export function creepStateBadges(states?: CreepTimedStates): HTMLElement {
	const statuses = statusEffectSummaries(states?.statuses ?? []);
	const entries: Array<{
		className: string;
		icon: string;
		tooltip: string;
		remaining?: number;
	}> = statuses.map((status) => ({
		className: `status-effect-${status.kind}`,
		icon: `${status.icon}${status.stacks > 1 ? ` ${status.stacks}` : ""}`,
		tooltip: status.tooltip,
		remaining: status.remaining,
	}));
	if (states?.regenerating)
		entries.push({
			className: "beneficial-effect-rapid-regen",
			icon: "✚",
			tooltip: "Regeneration increased",
		});
	if ((states?.reflectiveSurgeRemaining ?? 0) > 0)
		entries.push({
			className: "beneficial-effect-reflective-surge",
			icon: "◆",
			tooltip: "Reflective Surge",
			remaining: states!.reflectiveSurgeRemaining,
		});
	return (
		<div class="creep-state-badges" aria-label="Active states">
			{entries.map((entry) => (
				<span
					class={`creep-state-badge ${entry.className}`}
					title={entry.tooltip}
				>
					{entry.icon}
					{entry.remaining === undefined ? null : (
						<small class="effect-time" aria-hidden="true">
							{effectTimeLabel(entry.remaining)}
						</small>
					)}
				</span>
			))}
		</div>
	) as HTMLElement;
}
