import { FileView, Notice, TFile } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { AddFiletypeModal } from "@/modals/AddFiletypeModal";
import type SidecarPlugin from "@/main";
import { loggerDebug, loggerInfo } from "@/utils";

/**
 * Service responsible for handling context menus and menu interactions
 * Encapsulates menu logic and file opening behavior
 */
export class MenuService {
	private plugin: SidecarPlugin;

	constructor(plugin: SidecarPlugin) {
		this.plugin = plugin;
		loggerDebug(this, "MenuService initialized");
	}

	/**
	 * Register all menu handlers
	 */
	registerMenuHandlers(): void {
		loggerDebug(this, "Registering menu handlers");
		this.registerFileMenu();
	}

	/**
	 * Register file context menu handler
	 */
	private registerFileMenu(): void {
		loggerDebug(this, "Registering file menu handler");
		this.plugin.registerEvent(
			this.plugin.app.workspace.on("file-menu", (menu, file) => {
				if (file instanceof TFile && !this.plugin.isSidecarFile(file.path)) {
					menu.addItem((item) => {
						item
							.setTitle("Create sidecar for file")
							.setIcon("file-plus-2")
							.setSection("action")
							.onClick(async () => {
								await this.handleCreateSidecarForFile(file);
							});
					});
				}
			}),
		);
	}

	/**
	 * Handle creating a sidecar for a file, including extension management
	 */
	private async handleCreateSidecarForFile(file: TFile): Promise<void> {
		loggerDebug(this, "Handling create sidecar for file", { path: file.path });

		const ext = file.extension.toLowerCase();
		const monitored = this.plugin.settings.monitoredExtensions.map(
			(e: string) => e.toLowerCase(),
		);

		if (!monitored.includes(ext)) {
			loggerInfo(this, "Extension not monitored, showing add filetype modal", {
				extension: ext,
			});
			await this.showAddFiletypeModal(ext, file);
		} else {
			await this.createAndOpenSidecar(file);
		}
	}

	/**
	 * Show modal to add new file type and create sidecar
	 */
	private async showAddFiletypeModal(
		extension: string,
		file: TFile,
	): Promise<void> {
		loggerDebug(this, "Showing add filetype modal", { extension });

		return new Promise((resolve) => {
			new AddFiletypeModal(
				this.plugin.app,
				extension,
				async (newExt: string) => {
					if (
						!this.plugin.settings.monitoredExtensions
							.map((e: string) => e.toLowerCase())
							.includes(newExt)
					) {
						this.plugin.settings.monitoredExtensions.push(newExt);
						await this.plugin.saveSettings();
						new Notice(`Added .${newExt} to monitored file types.`);
						loggerInfo(this, "Added new file extension", { extension: newExt });
					}
					await this.createAndOpenSidecar(file);
					resolve();
				},
			).open();
		});
	}

	/**
	 * Create sidecar and open it in editor
	 */
	private async createAndOpenSidecar(file: TFile): Promise<void> {
		loggerDebug(this, "Creating and opening sidecar", { path: file.path });

		const sidecarPath = this.plugin.getSidecarPath(file.path);
		const existing = this.plugin.app.vault.getAbstractFileByPath(sidecarPath);

		if (!existing) {
			await this.plugin.sidecarManager.createSidecarForFile(file, true);
		}

		const sidecarFile =
			this.plugin.app.vault.getAbstractFileByPath(sidecarPath);
		if (sidecarFile instanceof TFile) {
			await this.openFileInEditor(sidecarFile);
		}

		if (existing) {
			new Notice("Sidecar already exists for this file.");
		}
	}

	/**
	 * Open file in editor, reusing existing tab if available
	 */
	private async openFileInEditor(file: TFile): Promise<void> {
		loggerDebug(this, "Opening file in editor", { path: file.path });

		// Check if file is already open
		let foundLeaf: WorkspaceLeaf | null = null;
		this.plugin.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
			if (
				leaf.view instanceof FileView &&
				leaf.view.file &&
				leaf.view.file.path === file.path
			) {
				foundLeaf = leaf;
			}
		});

		if (foundLeaf) {
			loggerDebug(this, "File already open, activating existing tab", {
				path: file.path,
			});
			this.plugin.app.workspace.setActiveLeaf(foundLeaf, { focus: true });
		} else {
			loggerDebug(this, "Opening file in new tab", { path: file.path });
			const leaf = this.plugin.app.workspace.getLeaf(true);
			await leaf.openFile(file);
			this.plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
		}
	}
}
