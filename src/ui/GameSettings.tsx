/** @jsx h */
import {
	DEFAULT_GRAPHICS_SETTINGS,
	type FullscreenMode,
	type LightingMode,
	MAX_RESOLUTION_SCALE,
	MIN_RESOLUTION_SCALE,
	RESOLUTION_SCALE_STEP,
	type ShadowMode,
} from "../game/graphicsSettings";
import { h } from "./dom";

export interface GameSettingsCallbacks {
	onSetFullscreenMode(mode: FullscreenMode): void;
	onSetResolutionScale(scale: number): void;
	onSetLightingMode(mode: LightingMode): void;
	onSetShadowMode(mode: ShadowMode): void;
	onSetAutoEquipOption(option: "items" | "spells", enabled: boolean): void;
}

export class GameSettings {
	private readonly resolutionScaleValue = (<output />) as HTMLOutputElement;
	private readonly resolutionScaleInput = (
		<input
			type="range"
			min={MIN_RESOLUTION_SCALE}
			max={MAX_RESOLUTION_SCALE}
			step={RESOLUTION_SCALE_STEP}
			value={DEFAULT_GRAPHICS_SETTINGS.resolutionScale}
			aria-label="Resolution scale"
		/>
	) as HTMLInputElement;
	private readonly fullscreenRadios = (["on", "off"] as const).map(
		(mode) =>
			(
				<input
					type="radio"
					name="game-fullscreen-on-start"
					value={mode}
					checked={mode === DEFAULT_GRAPHICS_SETTINGS.fullscreenMode}
				/>
			) as HTMLInputElement,
	);
	private readonly lightingRadios = (["off", "hero", "all"] as const).map(
		(mode) =>
			(
				<input
					type="radio"
					name="graphics-lighting"
					value={mode}
					checked={mode === DEFAULT_GRAPHICS_SETTINGS.lightingMode}
				/>
			) as HTMLInputElement,
	);
	private readonly shadowRadios = (["off", "dynamic"] as const).map(
		(mode) =>
			(
				<input
					type="radio"
					name="graphics-shadows"
					value={mode}
					checked={mode === DEFAULT_GRAPHICS_SETTINGS.shadowMode}
				/>
			) as HTMLInputElement,
	);
	private readonly autoEquipRadios = (["items", "spells"] as const).map(
		(option) =>
			([true, false] as const).map(
				(enabled) =>
					(
						<input
							type="radio"
							name={`auto-equip-${option}`}
							value={enabled ? "on" : "off"}
							checked={!enabled}
						/>
					) as HTMLInputElement,
			),
	);
	private readonly modal = (
		<section
			class="graphics-options-modal is-hidden"
			role="dialog"
			aria-modal="true"
			aria-label="Game settings"
		>
			<button
				class="graphics-options-close"
				type="button"
				aria-label="Close game settings"
			>
				×
			</button>
			<h2>Game Settings</h2>
			<fieldset class="graphics-option-group">
				<legend>Fullscreen on game start</legend>
				{this.fullscreenRadios.map((radio, index) => (
					<label>
						{radio}
						<span>{["On", "Off"][index]}</span>
					</label>
				))}
			</fieldset>
			<fieldset class="graphics-option-group resolution-scale-setting">
				<legend>Resolution scale</legend>
				{this.resolutionScaleInput}
				{this.resolutionScaleValue}
			</fieldset>
			<fieldset class="graphics-option-group">
				<legend>Lights</legend>
				{this.lightingRadios.map((radio, index) => (
					<label>
						{radio}
						<span>{["Off", "Hero only", "All"][index]}</span>
					</label>
				))}
			</fieldset>
			<fieldset class="graphics-option-group" data-graphics-shadows>
				<legend>Shadows</legend>
				{this.shadowRadios.map((radio, index) => (
					<label>
						{radio}
						<span>{["Off", "Dynamic"][index]}</span>
					</label>
				))}
			</fieldset>
			{this.autoEquipRadios.map((radios, optionIndex) => (
				<fieldset class="graphics-option-group">
					<legend>
						{optionIndex === 0 ? "Auto-equip items" : "Auto-equip new spells"}
					</legend>
					{radios.map((radio, index) => (
						<label>
							{radio}
							<span>{index === 0 ? "On" : "Off"}</span>
						</label>
					))}
				</fieldset>
			))}
		</section>
	) as HTMLElement;
	private readonly mask = (
		<div class="graphics-options-mask is-hidden" aria-hidden="true" />
	) as HTMLElement;
	private readonly shadowOptionsFieldset = this.modal.querySelector(
		"[data-graphics-shadows]",
	) as HTMLFieldSetElement;

	constructor(callbacks: GameSettingsCallbacks) {
		this.setResolutionScale(DEFAULT_GRAPHICS_SETTINGS.resolutionScale);
		(
			this.modal.querySelector(".graphics-options-close") as HTMLButtonElement
		).onclick = () => this.close();
		this.mask.onclick = () => this.close();
		for (const radio of this.fullscreenRadios)
			radio.onchange = () => {
				if (radio.checked)
					callbacks.onSetFullscreenMode(radio.value as FullscreenMode);
			};
		this.resolutionScaleInput.oninput = () => {
			const scale = this.resolutionScaleInput.valueAsNumber;
			this.setResolutionScale(scale);
			callbacks.onSetResolutionScale(scale);
		};
		for (const radio of this.lightingRadios)
			radio.onchange = () => {
				if (!radio.checked) return;
				const mode = radio.value as LightingMode;
				this.setLightingMode(mode);
				callbacks.onSetLightingMode(mode);
			};
		for (const radio of this.shadowRadios)
			radio.onchange = () => {
				if (!radio.checked) return;
				const mode = radio.value as ShadowMode;
				this.setShadowMode(mode);
				callbacks.onSetShadowMode(mode);
			};
		this.autoEquipRadios.forEach((radios, index) => {
			for (const radio of radios)
				radio.onchange = () => {
					if (radio.checked)
						callbacks.onSetAutoEquipOption(
							index === 0 ? "items" : "spells",
							radio.value === "on",
						);
				};
		});
	}

	appendTo(root: HTMLElement): void {
		root.append(this.mask, this.modal);
	}

	open(): void {
		this.mask.classList.remove("is-hidden");
		this.modal.classList.remove("is-hidden");
	}

	close(): void {
		this.mask.classList.add("is-hidden");
		this.modal.classList.add("is-hidden");
	}

	setFullscreenMode(mode: FullscreenMode): void {
		for (const radio of this.fullscreenRadios)
			radio.checked = radio.value === mode;
	}

	setResolutionScale(scale: number): void {
		this.resolutionScaleInput.value = String(scale);
		this.resolutionScaleValue.value = `${Math.round(scale * 100)}%`;
	}

	setLightingMode(mode: LightingMode): void {
		for (const radio of this.lightingRadios)
			radio.checked = radio.value === mode;
		this.shadowOptionsFieldset.disabled = mode === "off";
	}

	setShadowMode(mode: ShadowMode): void {
		for (const radio of this.shadowRadios) radio.checked = radio.value === mode;
	}

	setAutoEquipOptions(items: boolean, spells: boolean): void {
		for (const [index, enabled] of [items, spells].entries())
			for (const radio of this.autoEquipRadios[index])
				radio.checked = radio.value === (enabled ? "on" : "off");
	}
}
