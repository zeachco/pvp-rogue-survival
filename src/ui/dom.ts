export type Child = Node | string | number | boolean | null | undefined;

export function h(tag: string | ((props: Record<string, unknown>, ...children: Child[]) => Node), props: Record<string, unknown> | null, ...children: Child[]): Node {
  if (typeof tag === "function") return tag(props ?? {}, ...children);
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key === "class") element.className = String(value); else if (key === "style") element.setAttribute("style", String(value)); else if (key.startsWith("data-")) element.setAttribute(key, String(value)); else if (key in element) Reflect.set(element, key, value === true ? "" : value); else element.setAttribute(key, String(value));
  }
  appendChildren(element, children); return element;
}
export function Fragment(_props: unknown, ...children: Child[]): DocumentFragment { const fragment = document.createDocumentFragment(); appendChildren(fragment, children); return fragment; }
function appendChildren(parent: Node, children: Child[]): void { for (const child of children.flat(Infinity) as Child[]) if (child !== null && child !== undefined && child !== false && child !== true) parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child))); }
