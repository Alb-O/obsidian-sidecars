import { debug, warn, info, error, initLogger, registerLoggerClass } from '@/utils';
import { Notice, Plugin, TFile, FileView, App, WorkspaceLeaf } from 'obsidian';
import { AddFiletypeModal } from '@/modals/AddFiletypeModal';
import { OrphanSidecarModal } from '@/modals/OrphanSidecarModal';
import { SettingsManager } from '@/settings/SettingsManager';
import {
	isMonitoredFileUtil,
	getSidecarPathUtil,
	isSidecarFileUtil,
	getSourcePathFromSidecarUtil,
	getRedirectPathUtil,
	isRedirectFileUtil,
	getSourcePathFromRedirectUtil,
} from '@/utils';
import { DEFAULT_SETTINGS, SidecarPluginSettings } from '@/types';
import { updateSidecarFileAppearance, updateSidecarCss } from '@/explorer-style';
import { VaultEventHandler } from '@/events';
import { SidecarManager } from '@/SidecarManager';

export default class SidecarPlugin extends Plugin {
	sidecarAppearanceObserver?: MutationObserver;
	settings: SidecarPluginSettings;
	settingsManager: SettingsManager;
	sidecarManager: SidecarManager;
	vaultEventHandler: VaultEventHandler;

	public isInitialRevalidating = false;
	public hasFinishedInitialLoad = false;

	updateSidecarFileAppearance() {
		updateSidecarFileAppearance(this);
	}
	updateSidecarCss() {
		updateSidecarCss(this);
	}
	async onload() {
		debug(this, 'Plugin loading started');
		
		initLogger(this);
		registerLoggerClass(this, 'SidecarPlugin');
		this.settingsManager = new SettingsManager(this);
		registerLoggerClass(this.settingsManager, 'SettingsManager');
		await this.settingsManager.loadSettings();
		this.settings = this.settingsManager.getSettings();
		
		this.isInitialRevalidating = this.settings.revalidateOnStartup;
		this.hasFinishedInitialLoad = false;

		this.sidecarManager = new SidecarManager(this);
		registerLoggerClass(this.sidecarManager, 'SidecarManager');

		this.vaultEventHandler = new VaultEventHandler(this, this.sidecarManager);
		registerLoggerClass(this.vaultEventHandler, 'VaultEventHandler');

		this.addSettingTab(this.settingsManager.getSettingTab());

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
								const monitored = this.settings.monitoredExtensions.map((e: string) => e.toLowerCase());
								if (!monitored.includes(ext)) {
									new AddFiletypeModal(this.app, ext, async (newExt: string) => {
										if (!this.settings.monitoredExtensions.map((e: string) => e.toLowerCase()).includes(newExt)) {
											this.settings.monitoredExtensions.push(newExt);
											await this.saveSettings();
											new Notice(`Added .${newExt} to monitored file types.`);
										}
										await handleCreateSidecarForFile.call(this, file);
									}).open();
								} else {
									await handleCreateSidecarForFile.call(this, file);
								}
							});
					});
				}				async function handleCreateSidecarForFile(this: SidecarPlugin, file: TFile) {					const sidecarPath = this.getSidecarPath(file.path);
					const existing = this.app.vault.getAbstractFileByPath(sidecarPath);
					if (!existing) {
						await this.sidecarManager.createSidecarForFile(file, true);
					}
					const maybeFile = this.app.vault.getAbstractFileByPath(sidecarPath);
					if (maybeFile instanceof TFile) {
						let foundLeaf: WorkspaceLeaf | null = null;
						this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
							if (leaf.view instanceof FileView && leaf.view.file && leaf.view.file.path === maybeFile.path) {
								foundLeaf = leaf;
							}
						});
						if (foundLeaf) {
							this.app.workspace.setActiveLeaf(foundLeaf, { focus: true });						} else {
							const leaf = this.app.workspace.getLeaf(true);
							await leaf.openFile(maybeFile);
							this.app.workspace.setActiveLeaf(leaf, { focus: true });
						}
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
			}, 200);			this.registerEvent(this.app.vault.on('create', (file) => {
				if (!this.isInitialRevalidating && this.hasFinishedInitialLoad && file instanceof TFile) {
					this.vaultEventHandler.handleFileCreate(file);
				}
			}));

			this.registerEvent(this.app.vault.on('delete', (file) => {
				if (!this.isInitialRevalidating && this.hasFinishedInitialLoad && file instanceof TFile) {
					this.vaultEventHandler.handleFileDelete(file);
				}
			}));

			this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
				if (!this.isInitialRevalidating && this.hasFinishedInitialLoad && file instanceof TFile) {
					this.vaultEventHandler.handleFileRename(file, oldPath);
				}
			}));			if (this.settings.revalidateOnStartup) {
				debug(this, 'Starting initial revalidation');
				this.isInitialRevalidating = true;
				try {
					await this.revalidateSidecars();
				} catch (error) {
					warn(this, 'Error during initial revalidation:', error);
				} finally {
					this.isInitialRevalidating = false;
					this.hasFinishedInitialLoad = true;
					debug(this, 'Initial revalidation completed');
				}
			} else {
				this.hasFinishedInitialLoad = true;
				debug(this, 'Skipped initial revalidation, plugin ready');
			}
		});

		this.addCommand({
			id: 'revalidate-sidecars',
			name: 'Revalidate all sidecars',
			callback: () => {
				this.revalidateSidecars();
			},
		});
	}
	onunload() {
		debug(this, 'Plugin unloading');
		if (this.sidecarAppearanceObserver) {
			this.sidecarAppearanceObserver.disconnect();
			this.sidecarAppearanceObserver = undefined;
		}
	}
	async saveSettings(refreshStyles: boolean = true): Promise<void> {
		debug(this, 'Saving settings', { refreshStyles });
		await this.settingsManager.saveSettings();
		
		if (refreshStyles) {
			this.updateSidecarCss();
			this.updateSidecarFileAppearance();
		}
	}

	// This is the method that was missing in SidecarManager, now part of the plugin
	async showOrphanModal(
		orphanSidecars: string[],
		orphanReasons: Record<string, string>,
		postDeletionCallback: (deletedCount: number) => void
	): Promise<void> {
		return new Promise<void>((resolveOuterPromise) => {
			new OrphanSidecarModal(this.app, orphanSidecars, async () => {
				// This inner async function is the 'onConfirm' action for the modal.
				let actualDeletedCount = 0;
				for (const orphanPath of orphanSidecars) {
					try {
						const sidecarFileToDelete = this.app.vault.getAbstractFileByPath(orphanPath);
						if (sidecarFileToDelete instanceof TFile) {
							await this.app.fileManager.trashFile(sidecarFileToDelete);
							actualDeletedCount++;
							debug(this, `Deleted orphan sidecar ${orphanPath} because: ${orphanReasons[orphanPath]}`);
						}
					} catch (err) {
						warn(this, `Error deleting orphan sidecar ${orphanPath}`, { error: err });
					}
				}
				postDeletionCallback(actualDeletedCount);
				resolveOuterPromise(); // Resolve the promise after processing.
			}).open();
		});
	}
	async revalidateSidecars(): Promise<void> {
		debug(this, 'Starting sidecar revalidation');
		await this.sidecarManager.revalidateAllSidecars();
	}
	isMonitoredFile(filePath: string): boolean {
		return isMonitoredFileUtil(filePath, this.settings, (fp: string) => {
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

	getRedirectPath(filePath: string): string {
		return getRedirectPathUtil(filePath, this.settings);
	}

	isRedirectFile(filePath: string): boolean {
		return isRedirectFileUtil(filePath, this.settings);
	}

	getSourcePathFromRedirect(redirectPath: string): string | null {
		return getSourcePathFromRedirectUtil(redirectPath, this.settings);
	}
	hasRedirectFile(filePath: string): boolean {
		const redirectPath = this.getRedirectPath(filePath);
		return this.app.vault.getAbstractFileByPath(redirectPath) !== null;
	}

	sidecarMainFileHasRedirect(sidecarPath: string): boolean {
		const mainFilePath = this.getSourcePathFromSidecar(sidecarPath);
		if (!mainFilePath) return false;
		return this.hasRedirectFile(mainFilePath);
	}
}
