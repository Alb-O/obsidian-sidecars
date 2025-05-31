import { App, Modal, Setting } from "obsidian";

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
		modalEl.addClass('mod-orphan-sidecar-cleanup'); // Style like OrphanSidecarModal
		const modalHeader = modalEl.querySelector('.modal-header');
		if (modalHeader) {
			modalHeader.createDiv('modal-title', el => {
				el.textContent = 'Add file type to monitored list';
			});
		}
		contentEl.createEl("p", { text: `The file type '.${this.fileExt}' is not currently monitored by the Sidecar plugin. Would you like to add it to the list of monitored file types?` });
		new Setting(contentEl)
			.addButton(btn =>
				btn.setButtonText("Add file type")
				.setCta()
				.onClick(() => {
					this.close();
					this.onAccept(this.fileExt);
				})
			)
			.addButton(btn =>
				btn.setButtonText("Cancel")
				.onClick(() => this.close())
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}
