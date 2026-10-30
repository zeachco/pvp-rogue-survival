import type { RealmState } from "../../common/protocol";
import { h } from "./dom";

export function realmMemberSignature(
	member: RealmState["guards"][number],
): string {
	return `${member.id},${member.name},${member.level},${Number(member.down)},${Number(member.receivesDeathEchoes)}`;
}

export function rankedName(name: string, receivesDeathEchoes: boolean): Node {
	if (!receivesDeathEchoes) return document.createTextNode(name);
	const warning = (
		<span
			class="death-echo-warning"
			tabindex="0"
			aria-label="Highest-ranked hero: receives all other players' death echoes in this realm to fight against"
		>
			⚠
			<span role="tooltip">
				Highest-ranked hero: receives all other players' death echoes in this
				realm to fight against.
			</span>
		</span>
	) as HTMLElement;
	const wrapper = (
		<span class="ranked-name">
			{warning}
			{name}
		</span>
	) as HTMLElement;
	return wrapper;
}
