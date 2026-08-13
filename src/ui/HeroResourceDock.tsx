/** @jsx h */

import {
	rapidRegenMultiplier,
	reflectiveSurgeBlockChanceBonus,
} from "../../common/combat";
import {
	cumulativeXpForLevel,
	lerpXpDisplay,
	levelForXp,
	xpForNextLevel,
} from "../../common/progression";
import { effectiveSkillLevel } from "../game/systems/HeroCombatSystem";
import type { PlayerState, StatusEffectSnapshot } from "../game/types";
import { h } from "./dom";

interface ResourceBar {
	node: HTMLElement;
	value: HTMLElement;
	regen: HTMLElement;
	fill: HTMLElement;
	loss: HTMLElement;
	overflow?: HTMLElement;
	overflowFill?: HTMLElement;
	previous?: number;
	lossTimer?: ReturnType<typeof setTimeout>;
}

export class HeroResourceDock {
	readonly node = (<section class="resource-dock" />) as HTMLElement;
	private readonly healthBar = resourceBar("Health", "health");
	private readonly manaBar = resourceBar("Mana", "mana");
	private readonly statusEffects = (
		<div class="status-effects" aria-label="Active status effects" />
	) as HTMLElement;
	private readonly beneficialEffects = (
		<div class="beneficial-effects" aria-label="Active beneficial effects" />
	) as HTMLElement;
	private readonly timedEffects = (
		<div class="timed-effects" />
	) as HTMLElement;
	private readonly rageLine = (
		<div
			class="rage-line"
			role="progressbar"
			aria-label="Rage"
			aria-valuemin="0"
		>
			<span />
		</div>
	) as HTMLElement;
	private readonly rageValue = (<small class="rage-value" />) as HTMLElement;
	private readonly xpName = (<small />) as HTMLElement;
	private readonly xpLevel = (<strong />) as HTMLElement;
	private readonly xpBadge = (
		<div
			class="xp-badge"
			role="progressbar"
			aria-label="Experience"
			aria-valuemin="0"
		>
			<div>
				{this.xpName}
				{this.xpLevel}
			</div>
		</div>
	) as HTMLElement;
	private readonly trainingModeStatus = (
		<div class="training-mode-status is-hidden">
			[Training Grounds - No Rewards]
		</div>
	) as HTMLElement;
	private readonly xpToast = (
		<div class="xp-toast" role="status" aria-live="polite" />
	) as HTMLElement;
	private xpToastTimer?: number;
	private displayedXp?: number;
	private signature = "";

	constructor() {
		this.timedEffects.append(this.statusEffects, this.beneficialEffects);
		this.node.append(
			(
				<div class="health-cluster">
					{this.timedEffects}
					{this.healthBar.node}
					{this.rageLine}
					{this.rageValue}
				</div>
			) as HTMLElement,
			(
				<div class="xp-cluster">
					{this.xpToast}
					{this.trainingModeStatus}
					{this.xpBadge}
				</div>
			) as HTMLElement,
			(<div class="mana-cluster">{this.manaBar.node}</div>) as HTMLElement,
		);
	}

	update(player: PlayerState, healthRegen: number, manaRegen: number): void {
		const targetXp = player.progress.xp;
		this.displayedXp =
			this.displayedXp === undefined
				? targetXp
				: lerpXpDisplay(this.displayedXp, targetXp);
		const shownLevel = levelForXp(this.displayedXp);
		const into = this.displayedXp - cumulativeXpForLevel(shownLevel);
		const needed = xpForNextLevel(shownLevel);
		const xpRatio = needed > 0 ? Math.max(0, Math.min(1, into / needed)) : 0;
		const signature = [
			player.health,
			player.maxHealth,
			healthRegen,
			player.rage,
			player.maxRage,
			player.mana,
			player.maxMana,
			manaRegen,
			this.displayedXp,
			shownLevel,
			player.name,
			...player.statuses.flatMap((status) => [
				status.kind,
				Math.ceil(status.remaining * 10) / 10,
				status.damagePerSecond,
			]),
			player.xpSendBuffs.map((buff) => buff.expiresAt).join(","),
			player.xpSendBuffs.map((buff) => buff.multiplier).join(","),
			xpSendBuffSummary(player.xpSendBuffs)?.remaining ?? 0,
			Math.ceil(player.reflectiveSurgeRemaining * 10) / 10,
			Math.ceil(player.rapidRegenRemaining * 10) / 10,
		]
			.map(flatValue)
			.join("|");
		if (signature === this.signature) return;
		this.signature = signature;
		updateResourceBar(
			this.healthBar,
			player.health,
			player.maxHealth,
			healthRegen,
		);
		this.renderStatusEffects(player.statuses);
		this.renderBeneficialEffects(player);
		updateResourceBar(this.manaBar, player.mana, player.maxMana, manaRegen);
		const rage = resourceRatio(player.rage, player.maxRage);
		setText(this.xpName, player.name);
		setText(this.xpLevel, String(shownLevel));
		this.rageLine.setAttribute("aria-valuemax", String(player.maxRage));
		this.rageLine.setAttribute("aria-valuenow", String(player.rage));
		(this.rageLine.firstElementChild as HTMLElement).style.width =
			`${rage * 100}%`;
		setText(this.rageValue, `${fmt(player.rage)} / ${fmt(player.maxRage)}`);
		this.xpBadge.style.setProperty("--xp-angle", `${xpRatio * 360}deg`);
		this.xpBadge.setAttribute("aria-valuemax", String(needed));
		this.xpBadge.setAttribute("aria-valuenow", String(into));
	}

	clear(): void {
		this.displayedXp = undefined;
		this.signature = "";
	}

	setTrainingMode(active: boolean): void {
		this.trainingModeStatus.classList.toggle("is-hidden", !active);
	}

	showXpToast(message: string): void {
		clearTimeout(this.xpToastTimer);
		this.xpToast.textContent = message;
		this.xpToast.classList.add("is-visible");
		this.xpToastTimer = window.setTimeout(
			() => this.xpToast.classList.remove("is-visible"),
			3200,
		);
	}

	private renderStatusEffects(statuses: StatusEffectSnapshot[]): void {
		if (
			this.statusEffects.matches(":hover") ||
			this.statusEffects.contains(document.activeElement)
		)
			return;
		this.statusEffects.replaceChildren(
			...statusEffectSummaries(statuses).map(
				(status) =>
					(
						<span
							class={`status-effect status-effect-${status.kind}`}
							tabindex="0"
							aria-label={status.tooltip}
						>
							<span aria-hidden="true">{status.icon}</span>
							<small class="effect-time" aria-hidden="true">
								{effectTimeLabel(status.remaining)}
							</small>
							{status.stacks > 1 ? (
								<b class="effect-stacks">{status.stacks}</b>
							) : null}
							<span class="status-effect-tooltip" role="tooltip">
								{status.tooltip}
							</span>
						</span>
					) as HTMLElement,
			),
		);
	}

	private renderBeneficialEffects(player: PlayerState): void {
		if (
			this.beneficialEffects.matches(":hover") ||
			this.beneficialEffects.contains(document.activeElement)
		)
			return;
		const buff = xpSendBuffSummary(player.xpSendBuffs);
		const rapidRegenLevel = effectiveSkillLevel(player.progress, "rapidRegen");
		const rapidRegenTooltip = `Rapid Regeneration — ${fmt(rapidRegenMultiplier(rapidRegenLevel) * 100)}% normal regeneration + 0.1 HP/s`;
		const reflectiveSurgeLevel = effectiveSkillLevel(
			player.progress,
			"reflectiveSurge",
		);
		const reflectiveSurgeTooltip = `Reflective Surge — doubles returned damage and adds ${fmt(reflectiveSurgeBlockChanceBonus(reflectiveSurgeLevel) * 100)}% block chance`;
		this.beneficialEffects.replaceChildren(
			...(player.rapidRegenRemaining > 0
				? [
						<span
							class="beneficial-effect beneficial-effect-rapid-regen"
							tabindex="0"
							aria-label={rapidRegenTooltip}
						>
							<span aria-hidden="true">+</span>
							<small class="effect-time" aria-hidden="true">
								{effectTimeLabel(player.rapidRegenRemaining)}
							</small>
							<span class="beneficial-effect-tooltip" role="tooltip">
								{rapidRegenTooltip}
							</span>
						</span>,
					]
				: []),
			...(player.reflectiveSurgeRemaining > 0
				? [
						<span
							class="beneficial-effect beneficial-effect-reflective-surge"
							tabindex="0"
							aria-label={reflectiveSurgeTooltip}
						>
							<span aria-hidden="true">◈</span>
							<small class="effect-time" aria-hidden="true">
								{effectTimeLabel(player.reflectiveSurgeRemaining)}
							</small>
							<span class="beneficial-effect-tooltip" role="tooltip">
								{reflectiveSurgeTooltip}
							</span>
						</span>,
					]
				: []),
			...(buff
				? [
						<span
							class="beneficial-effect beneficial-effect-xp"
							tabindex="0"
							aria-label={buff.tooltip}
						>
							<b>{buff.label}</b>
							<small class="effect-time" aria-hidden="true">
								{effectTimeLabel(buff.remaining)}
							</small>
							<span class="beneficial-effect-tooltip" role="tooltip">
								{buff.tooltip}
							</span>
						</span>,
					]
				: []),
		);
	}
}

function resourceBar(label: string, kind: "health" | "mana"): ResourceBar {
	const value = (<span />) as HTMLElement;
	const regen = (<span class="resource-regen" />) as HTMLElement;
	const loss = (<span class="resource-loss" />) as HTMLElement;
	const fill = (<span class="resource-fill" />) as HTMLElement;
	const overflowFill =
		kind === "mana"
			? ((<span class="resource-overfill" />) as HTMLElement)
			: undefined;
	const overflow = overflowFill
		? ((
				<div class="resource-overfill-track">{overflowFill}</div>
			) as HTMLElement)
		: undefined;
	const node = (
		<div
			class={`resource-bar resource-${kind}`}
			role="progressbar"
			aria-label={label}
			aria-valuemin="0"
		>
			<div class="resource-bar-header">
				<strong>{label}</strong>
				<span class="resource-bar-values">
					{value}
					{regen}
				</span>
			</div>
			{overflow}
			<div class="resource-bar-track">
				{loss}
				{fill}
			</div>
		</div>
	) as HTMLElement;
	return { node, value, regen, fill, loss, overflow, overflowFill };
}

function updateResourceBar(
	bar: ResourceBar,
	current: number,
	maximum: number,
	regen: number,
): void {
	const safeMaximum = Math.max(0, maximum);
	const currentCap = bar.overflow ? safeMaximum * 3 : safeMaximum;
	const safeCurrent = Math.max(0, Math.min(current, currentCap));
	const ratio = resourceRatio(Math.min(safeCurrent, safeMaximum), safeMaximum);
	const previous = bar.previous;
	bar.node.setAttribute("aria-valuemax", String(safeMaximum));
	bar.node.setAttribute("aria-valuenow", String(safeCurrent));
	setText(bar.value, `${fmt(safeCurrent)} / ${fmt(safeMaximum)}`);
	setText(bar.regen, `+${fmt(Math.max(0, regen))}/s`);
	bar.fill.style.width = `${ratio * 100}%`;
	if (bar.overflow && bar.overflowFill) {
		const overfillRatio =
			safeMaximum > 0
				? Math.max(
						0,
						Math.min(1, (safeCurrent - safeMaximum) / (safeMaximum * 2)),
					)
				: 0;
		bar.overflow.classList.toggle("is-visible", overfillRatio > 0);
		bar.overflowFill.style.width = `${overfillRatio * 100}%`;
	}
	if (previous === undefined || safeCurrent >= previous) {
		if (bar.lossTimer) clearTimeout(bar.lossTimer);
		bar.lossTimer = undefined;
		bar.loss.classList.remove("is-catching-up");
		bar.loss.style.width = `${ratio * 100}%`;
	} else {
		bar.loss.classList.remove("is-catching-up");
		if (bar.lossTimer) clearTimeout(bar.lossTimer);
		bar.lossTimer = setTimeout(() => {
			bar.loss.classList.add("is-catching-up");
			bar.loss.style.width = `${ratio * 100}%`;
			bar.lossTimer = undefined;
		}, 420);
	}
	bar.previous = safeCurrent;
}

function resourceRatio(current: number, maximum: number): number {
	return maximum > 0 ? Math.max(0, Math.min(1, current / maximum)) : 0;
}

export interface StatusEffectSummary {
	kind: StatusEffectSnapshot["kind"];
	icon: string;
	stacks: number;
	remaining: number;
	damagePerSecond: number;
	tooltip: string;
}

export interface XpSendBuffSummary {
	multiplier: number;
	remaining: number;
	label: string;
	tooltip: string;
}

export function effectTimeLabel(remaining?: number): string {
	if (remaining === undefined || !Number.isFinite(remaining)) return "";
	const seconds = Math.max(0, Math.round(remaining));
	if (seconds <= 99) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	return `${minutes}m${remainder > 0 ? `${remainder}s` : ""}`;
}

export function xpSendBuffSummary(
	buffs: PlayerState["xpSendBuffs"],
	now = Date.now(),
): XpSendBuffSummary | undefined {
	const buff = buffs.find((entry) => entry.expiresAt > now);
	if (!buff) return undefined;
	const remaining = Math.max(0, Math.round((buff.expiresAt - now) / 1000));
	const percent = Math.round(buff.multiplier * 100);
	return {
		multiplier: buff.multiplier,
		remaining,
		label: `x${fmt(buff.multiplier)}`,
		tooltip: `XP Send bonus — ${percent}% XP`,
	};
}

const STATUS_EFFECT_PRESENTATION: Record<
	StatusEffectSnapshot["kind"],
	{ name: string; icon: string }
> = {
	bleed: { name: "Bleed", icon: "🩸" },
	poison: { name: "Poison", icon: "☠" },
	burn: { name: "Burn", icon: "🔥" },
	stun: { name: "Stun", icon: "✦" },
	freeze: { name: "Freeze", icon: "❄" },
	shock: { name: "Shock", icon: "✦" },
	curse: { name: "Curse", icon: "✧" },
};

export function statusEffectSummaries(
	statuses: StatusEffectSnapshot[],
): StatusEffectSummary[] {
	const summaries = new Map<
		StatusEffectSnapshot["kind"],
		Omit<StatusEffectSummary, "tooltip">
	>();
	for (const status of statuses) {
		const presentation = STATUS_EFFECT_PRESENTATION[status.kind];
		const summary = summaries.get(status.kind);
		if (summary) {
			summary.stacks += 1;
			summary.remaining = Math.max(summary.remaining, status.remaining);
			summary.damagePerSecond += status.damagePerSecond;
		} else
			summaries.set(status.kind, {
				kind: status.kind,
				icon: presentation.icon,
				stacks: 1,
				remaining: status.remaining,
				damagePerSecond: status.damagePerSecond,
			});
	}
	return [...summaries.values()].map((summary) => {
		const name = STATUS_EFFECT_PRESENTATION[summary.kind].name;
		const details: string[] = [];
		if (summary.stacks > 1) details.push(`${summary.stacks} stacks`);
		if (summary.damagePerSecond > 0)
			details.push(`${fmt(summary.damagePerSecond)} damage/s`);
		return {
			...summary,
			tooltip: details.length > 0 ? `${name} — ${details.join(" · ")}` : name,
		};
	});
}

function flatValue(value: string | number): string {
	return typeof value === "number"
		? String(Math.round(value * 100) / 100)
		: value;
}

function setText(node: HTMLElement, value: string): void {
	if (node.textContent !== value) node.textContent = value;
}

function fmt(value: number): string {
	return Number(value.toFixed(2)).toString();
}
