import { itemStackKey, type ItemInstance } from "../../common/items";
import { h } from "./dom";

export function loadoutCell(slot: string, item?: ItemInstance): HTMLElement {
	const label = `${slot}: ${item?.name ?? "Empty"}`;
	return (
		<span
			class={`loadout-cell${item ? ` rarity-${item.rarity}` : " is-empty"}`}
			data-equip-slot={slot.toLowerCase().replace(" ", "-")}
			data-stack-key={item ? itemStackKey(item) : ""}
			tabindex="0"
			aria-label={label}
		>
			<small>{slot}</small>
			<strong>{item?.name ?? "Empty"}</strong>
			<span role="tooltip">{label}</span>
		</span>
	) as HTMLElement;
}

export function equipSlotKeys(item: ItemInstance): string[] {
	return item.itemKind === "weapon"
		? item.hands === 2
			? ["main-hand", "offhand"]
			: ["main-hand"]
		: item.itemKind === "amulet"
			? ["amulet"]
			: item.itemKind === "charm"
				? ["charm"]
				: ["offhand"];
}
