export interface PreviewValue<T> {
	currentVal: T;
	newVal: T | null;
}
export type PreviewTone = "gain" | "cost" | "same";

export function formatPreviewValue<T>(
	value: PreviewValue<T>,
	format: (entry: T) => string = String,
): string {
	return value.newVal === null ? "—" : format(value.newVal);
}

export function formatProjectedValue<T>(
	value: PreviewValue<T>,
	format: (entry: T) => string = String,
): string {
	return format(value.newVal ?? value.currentVal);
}

export function previewTone(
	value: PreviewValue<number>,
	higherIsBetter = true,
): PreviewTone {
	if (value.newVal === null) return "cost";
	if (value.newVal === value.currentVal) return "same";
	const gain = value.newVal > value.currentVal;
	return gain === higherIsBetter ? "gain" : "cost";
}

export function applyPreviewClass(node: HTMLElement, tone: PreviewTone): void {
	node.classList.toggle("is-gain-preview", tone === "gain");
	node.classList.toggle("is-cost-preview", tone === "cost");
}
