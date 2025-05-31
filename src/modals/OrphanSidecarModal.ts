import { App, Modal, Setting } from "obsidian";

let activeOrphanSidecarModal: OrphanSidecarModal | null = null;

export class OrphanSidecarModal extends Modal {
	private orphanSidecars: string[];
	private onAccept: () => void;

	constructor(app: App, orphanSidecars: string[], onAccept: () => void) {
		// Dismiss any existing OrphanSidecarModal before opening a new one
		if (activeOrphanSidecarModal) {
			activeOrphanSidecarModal.close();
		}
		super(app);
		this.orphanSidecars = orphanSidecars;
		this.onAccept = onAccept;
		activeOrphanSidecarModal = this;
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('mod-orphan-sidecar-cleanup');
		// Set modal title in the header like the reference
		const modalHeader = modalEl.querySelector('.modal-header');
		if (modalHeader) {
			modalHeader.createDiv('modal-title', el => {
				el.textContent = 'Confirm orphan sidecar cleanup';
			});
		}
		contentEl.createEl("p", { text: `The following orphan sidecars will be deleted if you proceed:` });
		const list = contentEl.createEl("ul");
		this.orphanSidecars.forEach(path => {
			const li = list.createEl("li");
			const link = li.createEl("a", {
				text: path,
				href: `#${path}`
			});
			link.onclick = async (e) => {
				e.preventDefault();
				// Dismiss all open modals/dialogs (including settings)
				// @ts-ignore
				if (this.app && this.app.closeAllModals) {
					// @ts-ignore
					this.app.closeAllModals();
				} else {
					// fallback: close settings modal if open
					const modals = document.querySelectorAll('.modal-container, .modal-bg');
					modals.forEach(m => (m as HTMLElement).remove());
				}
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file) {
					// Try to find an existing leaf with this file open
					// @ts-ignore
					const leaves = this.app.workspace.getLeavesOfType("markdown");
					let found = false;
					for (const leaf of leaves) {
						// @ts-ignore
						if (leaf.view && leaf.view.file && leaf.view.file.path === path) {
							// @ts-ignore
							this.app.workspace.setActiveLeaf(leaf, { focus: true });
							found = true;
							break;
						}
					}
					if (!found) {
						// If not found, open in a new leaf
						const leaf = this.app.workspace.getLeaf(true);
						// @ts-ignore
						await leaf.openFile(file, { active: true });
					}
				}
				this.close();
			};
		});
		// Button row
		const buttonRow = contentEl.createDiv('modal-button-container');
		// Delete Orphans (left)
		const deleteBtn = buttonRow.createEl('button', { text: 'Delete orphans' });
		deleteBtn.addClass('mod-cta');
		deleteBtn.onclick = () => {
			this.close();
			this.onAccept();
		};
		// Cancel (right)
		const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
		cancelBtn.onclick = () => this.close();
	}

	onClose() {
		this.contentEl.empty();
		if (activeOrphanSidecarModal === this) {
			activeOrphanSidecarModal = null;
		}
	}
}
