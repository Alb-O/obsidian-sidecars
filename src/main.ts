import { debug, warn, initLogger, registerLoggerClass } from './utils/obsidian-logger';
import { Notice, Plugin, TFile, FileView, App, WorkspaceLeaf } from 'obsidian'; // Added App, WorkspaceLeaf
import { AddFiletypeModal } from './modals/AddFiletypeModal';
import { OrphanSidecarModal } from './modals/OrphanSidecarModal';
import { SidecarSettingTab } from './settings';
import {
	isMonitoredFileUtil,
	getSidecarPathUtil,
	isSidecarFileUtil,
	getSourcePathFromSidecarUtil,
	getRedirectPathUtil,
	isRedirectFileUtil,
	getSourcePathFromRedirectUtil,
} from './utils';
import { DEFAULT_SETTINGS, SidecarPluginSettings } from './settings';
import { updateSidecarFileAppearance, updateSidecarCss } from './explorer-style';
// import { handleFileCreate, handleFileDelete, handleFileRename } from './events'; // Remove direct import of functions
import { VaultEventHandler } from './VaultEventHandler'; // Import the class
import { SidecarManager } from './SidecarManager'; // Import the class

export default class SidecarPlugin extends Plugin {
	sidecarAppearanceObserver?: MutationObserver;
	settings: SidecarPluginSettings;
	sidecarManager: SidecarManager; // Add SidecarManager instance
	vaultEventHandler: VaultEventHandler; // Add VaultEventHandler instance

	public isInitialRevalidating = false;
	public hasFinishedInitialLoad = false;

	updateSidecarFileAppearance() {
		updateSidecarFileAppearance(this);
	}
	updateSidecarCss() {
		updateSidecarCss(this);
	}

	async onload() {
		// Initialize the logger system
		initLogger(this);
		registerLoggerClass(this, 'SidecarPlugin');
		await this.loadSettings(); // loadSettings will be changed
		this.isInitialRevalidating = this.settings.revalidateOnStartup;
		this.hasFinishedInitialLoad = false;

		this.sidecarManager = new SidecarManager(this); // Initialize SidecarManager
		registerLoggerClass(this.sidecarManager, 'SidecarManager'); // Register SidecarManager

		this.vaultEventHandler = new VaultEventHandler(this, this.sidecarManager); // Initialize VaultEventHandler
		registerLoggerClass(this.vaultEventHandler, 'VaultEventHandler'); // Register VaultEventHandler

		this.addSettingTab(new SidecarSettingTab(this.app, this));

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
				async function handleCreateSidecarForFile(this: SidecarPlugin, file: TFile) { // Changed 'this: any' to 'this: SidecarPlugin'
					const sidecarPath = this.getSidecarPath(file.path);
					const existing = this.app.vault.getAbstractFileByPath(sidecarPath);
					if (!existing) {
						// await createSidecarForFile(this, file, true); // force creation from context menu // Old call
						await this.sidecarManager.createSidecarForFile(file, true); // Use SidecarManager
					}
					// Immediately try to get the sidecar file
					const maybeFile = this.app.vault.getAbstractFileByPath(sidecarPath);
					if (maybeFile instanceof TFile) {
						// Try to find an already open leaf for this file
						let foundLeaf: WorkspaceLeaf | null = null; // Typed WorkspaceLeaf
						this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => { // Typed WorkspaceLeaf
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
						// warn or log if maybeFile is not a TFile after creation attempt
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
				if (!this.isInitialRevalidating && this.hasFinishedInitialLoad && file instanceof TFile) { // Added TFile check
					this.vaultEventHandler.handleFileCreate(file); // Use VaultEventHandler
				}
			}));

			this.registerEvent(this.app.vault.on('delete', (file) => {
				if (!this.isInitialRevalidating && this.hasFinishedInitialLoad && file instanceof TFile) { // Added TFile check
					this.vaultEventHandler.handleFileDelete(file); // Use VaultEventHandler
				}
			}));

			this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
				if (!this.isInitialRevalidating && this.hasFinishedInitialLoad && file instanceof TFile) { // Added TFile check
					this.vaultEventHandler.handleFileRename(file, oldPath); // Use VaultEventHandler
				}
			}));

			if (this.settings.revalidateOnStartup) {
				this.isInitialRevalidating = true;
				try {
					await this.revalidateSidecars();
				} catch (error) {
					console.error(`Error during initial revalidation:`, error);
				} finally {
					this.isInitialRevalidating = false;
					this.hasFinishedInitialLoad = true;
				}
			} else {
				this.hasFinishedInitialLoad = true;
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
		if (this.sidecarAppearanceObserver) {
			this.sidecarAppearanceObserver.disconnect();
			this.sidecarAppearanceObserver = undefined;
		}
	}
	async loadSettings() {
		// Use spread operator for robust merging of defaults and loaded settings
		this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) || {}) };

		// Ensure specific non-optional settings have their defaults if they somehow ended up undefined
		// This handles cases where a new setting is added or if loadedData explicitly had 'undefined'
		if (typeof this.settings.revalidateOnStartup === 'undefined') {
			this.settings.revalidateOnStartup = DEFAULT_SETTINGS.revalidateOnStartup;
		}
		if (typeof this.settings.redirectFileSuffix === 'undefined') {
			this.settings.redirectFileSuffix = DEFAULT_SETTINGS.redirectFileSuffix;
		}
		if (typeof this.settings.showRedirectDecorator === 'undefined') {
			this.settings.showRedirectDecorator = DEFAULT_SETTINGS.showRedirectDecorator;
		}
		if (typeof this.settings.showRedirectDecoratorOnSidecars === 'undefined') {
			this.settings.showRedirectDecoratorOnSidecars = DEFAULT_SETTINGS.showRedirectDecoratorOnSidecars;
		}
		// Add any other critical settings here if necessary, similar to the original pattern
	}

	async saveSettings(refreshStyles: boolean = true) {
		await this.saveData(this.settings);

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
					} catch (error) {
						console.error(`Error deleting orphan sidecar ${orphanPath}: `, error);
					}
				}
				postDeletionCallback(actualDeletedCount);
				resolveOuterPromise(); // Resolve the promise after processing.
			}).open();
		});
	}

	async revalidateSidecars() {
		// The revalidateAllSidecars method in SidecarManager will call showOrphanModal if needed.
		await this.sidecarManager.revalidateAllSidecars();
		// The notice and debug logs are now handled within revalidateAllSidecars or the modal callback.
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
