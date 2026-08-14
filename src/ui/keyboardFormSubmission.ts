export function isKeyboardFormSubmission(event: {
	key: string;
	shiftKey: boolean;
}): boolean {
	return event.key === "Enter" && !event.shiftKey;
}

export function submitFormOnEnter(form: HTMLFormElement): void {
	form.addEventListener("keydown", (event) => {
		if (!isKeyboardFormSubmission(event)) return;
		event.preventDefault();
		form.requestSubmit();
	});
}
