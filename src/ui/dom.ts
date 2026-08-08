export type Child = Node | string | number | boolean | null | undefined;

const SVG_TAGS = new Set([
	"svg",
	"circle",
	"path",
	"rect",
	"line",
	"polyline",
	"polygon",
	"ellipse",
	"g",
	"use",
	"defs",
	"stop",
	"linearGradient",
	"radialGradient",
	"clipPath",
	"mask",
	"pattern",
]);

export function h(
	tag:
		| string
		| ((props: Record<string, unknown>, ...children: Child[]) => Node),
	props: Record<string, unknown> | null,
	...children: Child[]
): Node {
	if (typeof tag === "function") return tag(props ?? {}, ...children);
	const SVG_NS = "http://www.w3.org/2000/svg";
	const isSvg = SVG_TAGS.has(tag);
	const element = isSvg
		? document.createElementNS(SVG_NS, tag)
		: document.createElement(tag);
	for (const [key, value] of Object.entries(props ?? {})) {
		if (value === false || value === null || value === undefined) continue;
		if (isSvg) element.setAttribute(key, String(value));
		else if (key === "class") element.className = String(value);
		else if (key === "style") element.setAttribute("style", String(value));
		else if (key.startsWith("data-")) element.setAttribute(key, String(value));
		else if (key in element) Reflect.set(element, key, value);
		else element.setAttribute(key, String(value));
	}
	appendChildren(element, children);
	return element;
}
export function Fragment(
	_props: unknown,
	...children: Child[]
): DocumentFragment {
	const fragment = document.createDocumentFragment();
	appendChildren(fragment, children);
	return fragment;
}
function appendChildren(parent: Node, children: Child[]): void {
	for (const child of children.flat(Infinity) as Child[])
		if (
			child !== null &&
			child !== undefined &&
			child !== false &&
			child !== true
		)
			parent.appendChild(
				child instanceof Node ? child : document.createTextNode(String(child)),
			);
}
