export interface TooltipPosition {
  left: number;
  top: number;
}

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
