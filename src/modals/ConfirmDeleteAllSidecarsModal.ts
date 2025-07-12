import { Modal } from "obsidian";
import type { App } from "obsidian";

export class ConfirmDeleteAllSidecarsModal extends Modal {
	private onAccept: () => void;

	constructor(app: App, onAccept: () => void) {
		super(app);
		this.onAccept = onAccept;
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass("mod-sidecar-delete-all-confirm");
		const modalHeader = modalEl.querySelector(".modal-header");
		if (modalHeader) {
			modalHeader.createDiv("modal-title", (el) => {
				el.textContent = "Delete all sidecar files?";
			});
		}
		contentEl.createEl("p", {
			text: "Are you sure you want to delete all sidecar files in this vault? This cannot be undone and will remove all sidecar files managed by this plugin.",
		});
		const buttonRow = contentEl.createDiv("modal-button-container");
		// Delete (left)
		const deleteBtn = buttonRow.createEl("button", {
			text: "Delete all sidecars",
		});
		deleteBtn.addClass("mod-warning");
		deleteBtn.onclick = () => {
			this.onAccept();
			this.close();
		};
		// Cancel (right)
		const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
		cancelBtn.onclick = () => this.close();
	}
}
