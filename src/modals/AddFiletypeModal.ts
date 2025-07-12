import { Modal } from "obsidian";
import type { App } from "obsidian";

export class AddFiletypeModal extends Modal {
	private fileExt: string;
	private onAccept: (ext: string) => void;

	constructor(app: App, fileExt: string, onAccept: (ext: string) => void) {
		super(app);
		this.fileExt = fileExt;
		this.onAccept = onAccept;
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass("mod-orphan-sidecar-cleanup"); // Style like OrphanSidecarModal
		const modalHeader = modalEl.querySelector(".modal-header");
		if (modalHeader) {
			modalHeader.createDiv("modal-title", (el) => {
				el.textContent = "Add file type to monitored list";
			});
		}
		contentEl.createEl("p", {
			text: `The file type '.${this.fileExt}' is not currently monitored by the Sidecar plugin. Would you like to add it to the list of monitored file types?`,
		});
		// Button row
		const buttonRow = contentEl.createDiv("modal-button-container");
		// Add file type (left)
		const addBtn = buttonRow.createEl("button", { text: "Add file type" });
		addBtn.addClass("mod-cta");
		addBtn.onclick = () => {
			this.close();
			this.onAccept(this.fileExt);
		};
		// Cancel (right)
		const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
		cancelBtn.onclick = () => this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}
