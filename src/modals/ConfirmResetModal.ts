import type { App } from "obsidian";
import { Modal, Setting } from "obsidian";

export class ConfirmResetModal extends Modal {
	private onAccept: () => void;

	constructor(app: App, onAccept: () => void) {
		super(app);
		this.onAccept = onAccept;
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass("mod-sidecar-reset-confirm");
		const modalHeader = modalEl.querySelector(".modal-header");
		if (modalHeader) {
			modalHeader.createDiv("modal-title", (el) => {
				el.textContent = "Reset all settings to default?";
			});
		}
		contentEl.createEl("p", {
			text: "Are you sure you want to reset all Sidecar settings to their default values? This cannot be undone.",
		});
		const buttonRow = contentEl.createDiv("modal-button-container");
		new Setting(buttonRow)
			.addButton((btn) =>
				btn
					.setButtonText("Reset to defaults")
					.setClass("mod-warning")
					.onClick(() => {
						this.onAccept();
						this.close();
					}),
			)
			.addButton((btn) =>
				btn
					.setButtonText("Cancel")
					.setClass("mod-cancel")
					.onClick(() => this.close()),
			);
	}
}
