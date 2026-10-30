export function trimTo2Decimals(value: number): string {
	return Number(value.toFixed(2)).toString();
}
export function capitalize(value: string): string {
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
