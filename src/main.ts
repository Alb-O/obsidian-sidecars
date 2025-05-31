import { Notice, Plugin, TFile, FileSystemAdapter, FileView } from 'obsidian';
import { AddFiletypeModal } from './AddFiletypeModal';
import { OrphanSidecarModal } from './OrphanSidecarModal';
import { SidecarSettingTab } from './settings';
import {
	isMonitoredFileUtil,
	getSidecarPathUtil,
	isSidecarFileUtil,
	getSourcePathFromSidecarUtil,
} from './utils';
import { DEFAULT_SETTINGS, SidecarPluginSettings } from './settings';
import { updateSidecarFileAppearance, updateSidecarCss } from './explorer-style';
import { PathInoMapService } from './external-rename/PathInoMapService';
import { ExternalFileHandler } from './external-rename/ExternalFileHandler';
import { handleFileCreate, handleFileDelete, handleFileRename } from './events';
import { createSidecarForFile } from './sidecar-manager';

export default class SidecarPlugin extends Plugin {
	sidecarAppearanceObserver?: MutationObserver;
	settings: SidecarPluginSettings;
	fileSystemAdapter!: FileSystemAdapter;
	pathInoMapService!: PathInoMapService;
	externalFileHandler!: ExternalFileHandler;

	public isInitialRevalidating = false;
	public hasFinishedInitialLoad = false;

	updateSidecarFileAppearance() {
		updateSidecarFileAppearance(this);
	}
	updateSidecarCss() {
		updateSidecarCss(this);
	}

	async onload() {
		await this.loadSettings();
		this.isInitialRevalidating = this.settings.revalidateOnStartup;
		this.hasFinishedInitialLoad = false;

		this.addSettingTab(new SidecarSettingTab(this.app, this));

		this.pathInoMapService = new PathInoMapService();
		await this.pathInoMapService.init(this.app);

		// Add context menu item to create sidecar for file
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile && !this.isSidecarFile(file.path)) {
					menu.addItem((item) => {
						item.setTitle('Create sidecar for file')
							.setIcon('file-plus-2')
							.setSection('action')
							.onClick(async () => {
								const ext = file.extension.toLowerCase();
								const monitored = this.settings.monitoredExtensions.map(e => e.toLowerCase());
								if (!monitored.includes(ext)) {
									new AddFiletypeModal(this.app, ext, async (newExt) => {
										if (!this.settings.monitoredExtensions.map(e => e.toLowerCase()).includes(newExt)) {
											this.settings.monitoredExtensions.push(newExt);
											await this.saveSettings();
											new Notice(`Added .${newExt} to monitored file types.`);
										}
										// After adding, proceed to create sidecar
										await handleCreateSidecarForFile.call(this, file);
									}).open();
								} else {
									await handleCreateSidecarForFile.call(this, file);
								}
							});
					});
				}

// Helper function to handle sidecar creation and opening
async function handleCreateSidecarForFile(this: any, file: TFile) {
	const sidecarPath = this.getSidecarPath(file.path);
	const existing = this.app.vault.getAbstractFileByPath(sidecarPath);
	if (!existing) {
		await createSidecarForFile(this, file, true); // force creation from context menu
	}
	// Immediately try to get the sidecar file
	const maybeFile = this.app.vault.getAbstractFileByPath(sidecarPath);
	if (maybeFile instanceof TFile) {
		// Try to find an already open leaf for this file
		let foundLeaf = null;
		this.app.workspace.iterateAllLeaves((leaf: import('obsidian').WorkspaceLeaf) => {
			if (leaf.view instanceof FileView && leaf.view.file && leaf.view.file.path === maybeFile.path) {
				foundLeaf = leaf;
			}
		});
		if (foundLeaf) {
			this.app.workspace.setActiveLeaf(foundLeaf, { focus: true });
		} else {
			const leaf = this.app.workspace.getLeaf(true);
			await leaf.openFile(maybeFile);
			this.app.workspace.setActiveLeaf(leaf, { focus: true });
		}
	} else {
	}
	if (existing) {
		new Notice('Sidecar already exists for this file.');
	}
}
			})
		);
		this.app.workspace.onLayoutReady(async () => {
			setTimeout(() => {
				this.updateSidecarCss();
				this.updateSidecarFileAppearance();
			}, 200);

			// Register core Obsidian vault event listeners for sidecar management
			this.registerEvent(this.app.vault.on('create', (file) => {
				if (!this.isInitialRevalidating && this.hasFinishedInitialLoad) {
					handleFileCreate(this, file);
				}
			}));

			this.registerEvent(this.app.vault.on('delete', (file) => {
				if (!this.isInitialRevalidating && this.hasFinishedInitialLoad) {
					handleFileDelete(this, file);
				}
			}));

			this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
				if (!this.isInitialRevalidating && this.hasFinishedInitialLoad) {
					handleFileRename(this, file, oldPath);
				}
			}));

			if (this.settings.revalidateOnStartup) {
				this.isInitialRevalidating = true;
				try {
					await this.revalidateSidecars();
				} catch (error) {
					console.error(`Sidecar Plugin: Error during initial revalidation:`, error);
				} finally {
					this.isInitialRevalidating = false;
					this.hasFinishedInitialLoad = true;
				}
			} else {
				this.hasFinishedInitialLoad = true;
			}

			if (this.app.vault.adapter instanceof FileSystemAdapter) {
				this.fileSystemAdapter = this.app.vault.adapter;
				this.externalFileHandler = new ExternalFileHandler(this, this.pathInoMapService, this.fileSystemAdapter);
				await this.externalFileHandler.init();
			} else {
				new Notice("Sidecar Plugin: FileSystemAdapter not available. External file move/rename detection will not work.");
			}
		});

		this.addCommand({
			id: 'revalidate-sidecars',
			name: 'Revalidate all sidecars',
			callback: () => {
				this.revalidateSidecars();
			},
		});
		new Notice('Sidecar Plugin loaded.');
	}

	onunload() {
		if (this.sidecarAppearanceObserver) {
			this.sidecarAppearanceObserver.disconnect();
			this.sidecarAppearanceObserver = undefined;
		}
		if (this.externalFileHandler) {
			this.externalFileHandler.cleanup();
		}
		if (this.pathInoMapService) {
			this.pathInoMapService.close();
		}
		new Notice('Sidecar Plugin unloaded.');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		if (typeof this.settings.revalidateOnStartup === 'undefined') {
			this.settings.revalidateOnStartup = DEFAULT_SETTINGS.revalidateOnStartup;
		}
		if (typeof this.settings.redirectFileSuffix === 'undefined') {
			this.settings.redirectFileSuffix = DEFAULT_SETTINGS.redirectFileSuffix;
		}
	}

	async saveSettings(refreshStyles: boolean = true) {
		await this.saveData(this.settings); // this.settings now has the new values and they are saved.

		// Ensure externalFileHandler instance exists if it's needed and wasn't created during onload
		if (this.settings.enableExternalRenameDetection && !this.externalFileHandler && this.app.vault.adapter instanceof FileSystemAdapter) {
			if (!this.pathInoMapService) { // Should always exist, but good to be defensive
				this.pathInoMapService = new PathInoMapService();
				await this.pathInoMapService.init(this.app);
				console.log('Sidecar Plugin: PathInoMapService initialized in saveSettings as it was missing.');
			}
			this.fileSystemAdapter = this.app.vault.adapter;
			this.externalFileHandler = new ExternalFileHandler(this, this.pathInoMapService, this.fileSystemAdapter);
			console.log('Sidecar Plugin: ExternalFileHandler instance created in saveSettings.');
		}

		if (this.externalFileHandler) {
			if (this.settings.enableExternalRenameDetection) {
				console.log('Sidecar Plugin: Setting change: External rename detection is now enabled. Initializing/Re-initializing ExternalFileHandler.');
				await this.externalFileHandler.init();
			} else {
				console.log('Sidecar Plugin: Setting change: External rename detection is now disabled. Cleaning up ExternalFileHandler.');
				this.externalFileHandler.cleanup();
			}
		} else if (this.settings.enableExternalRenameDetection) {
			// This case means externalFileHandler couldn't be created (e.g., adapter still not ready)
			console.warn('Sidecar Plugin: External rename detection is enabled, but ExternalFileHandler could not be initialized/created (FileSystemAdapter might not be ready).');
			new Notice("Sidecar: External rename detection enabled, but couldn't start. FileSystemAdapter might not be ready. Try restarting Obsidian or check console.");
		}

		if (refreshStyles) {
			this.updateSidecarCss();
			this.updateSidecarFileAppearance();
		}
	}

async revalidateSidecars() {
	new Notice(`Starting sidecar revalidation...`, 3000);

	let newlyCreatedSidecarCount = 0;
	let countMonitoredFilesWithSidecars = 0;
	let deletedOrphanCount = 0;

	const allFiles = this.app.vault.getFiles();
	const allFilePaths = new Set(allFiles.map(f => f.path));

	for (const file of allFiles) {
		const isMonitored = this.isMonitoredFile(file.path);
		const sidecarPath = this.getSidecarPath(file.path);
		const initialSidecarExists = allFilePaths.has(sidecarPath);

		if (isMonitored) {
			let sidecarEnsuredThisIteration = initialSidecarExists;

			if (!initialSidecarExists && (this.settings.autoCreateSidecars ?? true)) {
				try {
					const createdFile = await this.app.vault.create(sidecarPath, '');

					if (createdFile) {
						newlyCreatedSidecarCount++;
						allFilePaths.add(sidecarPath);
						sidecarEnsuredThisIteration = true;
					} else {
						console.warn(`Sidecar Plugin: vault.create for ${sidecarPath} returned null/undefined. Sidecar might not have been created.`);
					}
				} catch (error) {
					console.error(`Sidecar Plugin: Error creating sidecar for ${file.path} at ${sidecarPath} during revalidation: `, error);
				}
			}
			if (sidecarEnsuredThisIteration) {
				countMonitoredFilesWithSidecars++;
			}
		}
	}

	const currentFilesAfterCreation = this.app.vault.getFiles();
	// Collect orphans first
	const orphanSidecars: string[] = [];
	const orphanReasons: Record<string, string> = {};
	for (const file of currentFilesAfterCreation) {
		if (this.isSidecarFile(file.path)) {
			const sourcePath = this.getSourcePathFromSidecar(file.path);
			let shouldDelete = false;
			let reason = "";
			if (!sourcePath) {
				shouldDelete = true;
				reason = "malformed name or unidentifiable main file";
			} else {
				const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
				if (!sourceFile) {
					shouldDelete = true;
					reason = "orphaned (main file missing)";
				} else if (!(sourceFile instanceof TFile)) {
					shouldDelete = true;
					reason = "main file is a folder, not a file";
				} else {
					if (!this.isMonitoredFile(sourcePath)) {
						shouldDelete = true;
						reason = "main file no longer monitored";
					}
				}
			}
			if (shouldDelete) {
				orphanSidecars.push(file.path);
				orphanReasons[file.path] = reason;
			}
		}
	}

	if (orphanSidecars.length > 0) {
		// Show modal and only delete if user accepts
		return new Promise<void>((resolve) => {
			new OrphanSidecarModal(this.app, orphanSidecars, async () => {
				for (const orphanPath of orphanSidecars) {
					try {
						const sidecarFileToDelete = this.app.vault.getAbstractFileByPath(orphanPath);
						if (sidecarFileToDelete instanceof TFile) {
							await this.app.vault.delete(sidecarFileToDelete);
							deletedOrphanCount++;
							console.log(`Sidecar Plugin: Deleted orphan sidecar ${orphanPath} because: ${orphanReasons[orphanPath]}`);
						}
					} catch (error) {
						console.error(`Sidecar Plugin: Error deleting orphan sidecar ${orphanPath}: `, error);
					}
				}
				console.log(`Sidecar Plugin: Revalidation complete. Newly created sidecars: ${newlyCreatedSidecarCount}, Monitored files with sidecars: ${countMonitoredFilesWithSidecars}, Deleted orphans: ${deletedOrphanCount}`);
				new Notice(`Sidecar revalidation complete: ${newlyCreatedSidecarCount} created, ${countMonitoredFilesWithSidecars} monitored, ${deletedOrphanCount} orphans deleted.`);
				resolve();
			}).open();
		});
	} else {
		console.log(`Sidecar Plugin: Revalidation complete. Newly created sidecars: ${newlyCreatedSidecarCount}, Monitored files with sidecars: ${countMonitoredFilesWithSidecars}, Deleted orphans: ${deletedOrphanCount}`);
		new Notice(`Sidecar revalidation complete: ${newlyCreatedSidecarCount} created, ${countMonitoredFilesWithSidecars} monitored, ${deletedOrphanCount} orphans deleted.`);
	}
}

	isMonitoredFile(filePath: string): boolean {
		return isMonitoredFileUtil(filePath, this.settings, (fp) => {
			return this.isSidecarFile(fp);
		});
	}

	getSidecarPath(filePath: string): string {
		return getSidecarPathUtil(filePath, this.settings);
	}

	isSidecarFile(filePath: string): boolean {
		return isSidecarFileUtil(filePath, this.settings);
	}

	getSourcePathFromSidecar(sidecarPath: string): string | null {
		return getSourcePathFromSidecarUtil(sidecarPath, this.settings);
	}
}
