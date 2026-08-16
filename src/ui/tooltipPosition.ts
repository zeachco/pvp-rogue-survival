export interface TooltipPosition {
	left: number;
	top: number;
}

const TOOLTIP_SELECTOR = '[role="tooltip"]';

export function viewportTooltipPosition(
	anchor: Pick<DOMRect, "left" | "right" | "bottom">,
	tooltipWidth: number,
	tooltipHeight: number,
	viewportWidth: number,
	viewportHeight: number,
	gap = 10,
	margin = 8,
): TooltipPosition {
	const rightPosition = anchor.right + gap;
	const leftPosition = anchor.left - gap - tooltipWidth;
	const left =
		rightPosition + tooltipWidth <= viewportWidth - margin
			? rightPosition
			: Math.max(margin, leftPosition);
	return {
		left: Math.min(
			Math.max(margin, left),
			Math.max(margin, viewportWidth - margin - tooltipWidth),
		),
		top: Math.min(
			Math.max(margin, anchor.bottom - tooltipHeight),
			Math.max(margin, viewportHeight - margin - tooltipHeight),
		),
	};
}

function tooltipAnchor(
	target: EventTarget | null,
	root: HTMLElement,
): HTMLElement | undefined {
	let node = target instanceof Element ? target : undefined;
	while (node && node !== root) {
		const tooltip = Array.from(node.children).find(
			(child): child is HTMLElement => child.matches(TOOLTIP_SELECTOR),
		);
		if (tooltip && node instanceof HTMLElement) return node;
		node = node.parentElement ?? undefined;
	}
	return undefined;
}

export function attachViewportTooltips(root: HTMLElement): () => void {
	let pointerAnchor: HTMLElement | undefined;
	let focusAnchor: HTMLElement | undefined;
	let overlay: HTMLElement | undefined;

	const hide = () => {
		root
			.querySelectorAll(".viewport-tooltip-source-active")
			.forEach((source) =>
				source.classList.remove("viewport-tooltip-source-active"),
			);
		overlay?.remove();
		overlay = undefined;
	};
	const show = (anchor: HTMLElement | undefined) => {
		hide();
		if (!anchor?.isConnected) return;
		const template = Array.from(anchor.children).find(
			(child): child is HTMLElement => child.matches(TOOLTIP_SELECTOR),
		);
		if (!template) return;
		template.classList.add("viewport-tooltip-source-active");
		overlay = template.cloneNode(true) as HTMLElement;
		overlay.removeAttribute("id");
		overlay.classList.remove("viewport-tooltip-source-active");
		overlay.classList.add("viewport-tooltip-overlay");
		document.body.append(overlay);
		const tooltipRect = overlay.getBoundingClientRect();
		const position = viewportTooltipPosition(
			anchor.getBoundingClientRect(),
			tooltipRect.width,
			tooltipRect.height,
			window.innerWidth,
			window.innerHeight,
		);
		overlay.style.left = `${position.left}px`;
		overlay.style.top = `${position.top}px`;
	};
	const refresh = () => show(focusAnchor ?? pointerAnchor);
	const onPointerOver = (event: PointerEvent) => {
		pointerAnchor = tooltipAnchor(event.target, root);
		refresh();
	};
	const onPointerOut = (event: PointerEvent) => {
		if (
			pointerAnchor &&
			event.relatedTarget instanceof Node &&
			pointerAnchor.contains(event.relatedTarget)
		)
			return;
		pointerAnchor = undefined;
		refresh();
	};
	const onFocusIn = (event: FocusEvent) => {
		focusAnchor = tooltipAnchor(event.target, root);
		refresh();
	};
	const onFocusOut = (event: FocusEvent) => {
		if (
			focusAnchor &&
			event.relatedTarget instanceof Node &&
			focusAnchor.contains(event.relatedTarget)
		)
			return;
		focusAnchor = undefined;
		refresh();
	};

	root.addEventListener("pointerover", onPointerOver);
	root.addEventListener("pointerout", onPointerOut);
	root.addEventListener("focusin", onFocusIn);
	root.addEventListener("focusout", onFocusOut);
	window.addEventListener("resize", refresh);
	window.addEventListener("scroll", refresh, true);
	return () => {
		hide();
		root.removeEventListener("pointerover", onPointerOver);
		root.removeEventListener("pointerout", onPointerOut);
		root.removeEventListener("focusin", onFocusIn);
		root.removeEventListener("focusout", onFocusOut);
		window.removeEventListener("resize", refresh);
		window.removeEventListener("scroll", refresh, true);
	};
}
