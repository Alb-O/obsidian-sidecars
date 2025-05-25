import { Notice, Plugin, TFile } from 'obsidian';
import { SidecarSettingTab } from './settings';
import {
	isMonitoredFileUtil,
	getSidecarPathUtil,
	isSidecarFileUtil,
	getSourcePathFromSidecarUtil,
	isRedirectFileUtil,
	getRedirectFilePathUtil,
	getSourcePathFromRedirectFileUtil,
	isRedirectFileManagementEnabledUtil
} from './utils'; // Updated imports
import { DEFAULT_SETTINGS, SidecarPluginSettings } from './settings';
import { updateSidecarFileAppearance, updateSidecarCss } from './explorer-style';
import { handleFileCreate, handleFileDelete, handleFileRename } from './events';
import { cleanupAllRedirectFiles } from './redirect-manager';

export default class SidecarPlugin extends Plugin {
	sidecarAppearanceObserver?: MutationObserver; // Renamed from sidecarDraggableObserver

	settings: SidecarPluginSettings;
	public isInitialRevalidating = false; // Flag to manage initial revalidation state
	public hasFinishedInitialLoad = false; // True after initial vault load

	updateSidecarFileAppearance() {
		updateSidecarFileAppearance(this);
	}
	updateSidecarCss() {
		updateSidecarCss(this);
	}	async onload() {
		await this.loadSettings();
		this.isInitialRevalidating = this.settings.revalidateOnStartup;
		this.hasFinishedInitialLoad = false;

		this.addSettingTab(new SidecarSettingTab(this.app, this));
		// Dev-utils rename/delete integration removed due to conflicts; using manual handlers exclusively
		console.warn('Sidecar Plugin: using manual rename/delete handlers only.');
		this.registerDirectEventHandlers();
		this.app.workspace.onLayoutReady(async () => {
			// Delay DOM manipulations to give Obsidian's UI more time to fully render after a full app reload
			setTimeout(() => {
				this.updateSidecarCss();
				this.updateSidecarFileAppearance();
			}, 200);// Increased delay to 200ms for more reliable tag rendering

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
				// Ensure appearance is updated even if revalidation is off
				// (it's already called above, but good to be explicit if logic changes)
			}
		});

		this.addCommand({
			id: 'revalidate-sidecars',
			name: 'Revalidate all sidecars',
			callback: () => {
				this.revalidateSidecars();
			},
		});

		this.addCommand({
			id: 'cleanup-redirect-files',
			name: 'Cleanup all redirect files',
			callback: () => {
				this.cleanupRedirectFiles();
			},
		});
		new Notice('Sidecar Plugin loaded.');
	}	private registerDirectEventHandlers() {
		console.log('Sidecar Plugin: Registering event handlers...');
		this.registerEvent(this.app.vault.on('create', (file) => handleFileCreate(this, file)));
		this.registerEvent(this.app.vault.on('delete', (file) => handleFileDelete(this, file)));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => handleFileRename(this, file, oldPath)));
		console.log('Sidecar Plugin: Event handlers registered.');
	}

	onunload() {
		if (this.sidecarAppearanceObserver) { // Changed from sidecarDraggableObserver
			this.sidecarAppearanceObserver.disconnect();
			this.sidecarAppearanceObserver = undefined;
		}
		new Notice('Sidecar Plugin unloaded.');
	}

	async loadSettings() {
		// Load user settings, using defaults only for unspecified properties
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		// Ensure revalidateOnStartup has a default value if it's missing from saved data (for upgrades)
		if (typeof this.settings.revalidateOnStartup === 'undefined') {
			this.settings.revalidateOnStartup = DEFAULT_SETTINGS.revalidateOnStartup;
		}
		// Ensure new "redirect file" settings have defaults if missing (for upgrades)
		if (typeof this.settings.enableRedirectFile === 'undefined') {
			this.settings.enableRedirectFile = DEFAULT_SETTINGS.enableRedirectFile;
		}
		if (typeof this.settings.redirectFileSuffix === 'undefined') {
			this.settings.redirectFileSuffix = DEFAULT_SETTINGS.redirectFileSuffix;
		}
	} async saveSettings(refreshStyles: boolean = true) {
		await this.saveData(this.settings);
		if (refreshStyles) {
			this.updateSidecarCss();
			this.updateSidecarFileAppearance();
		}
	}

	async cleanupRedirectFiles() {
		await cleanupAllRedirectFiles(this);
	}

	async revalidateSidecars() {
		new Notice(`Starting sidecar revalidation...`, 3000);

		let newlyCreatedSidecarCount = 0;
		let countMonitoredFilesWithSidecars = 0;
		let deletedOrphanCount = 0;

		const allFiles = this.app.vault.getFiles();
		const allFilePaths = new Set(allFiles.map(f => f.path));

		// Phase 1: Ensure monitored files have sidecars
		for (const file of allFiles) {
			const isMonitored = this.isMonitoredFile(file.path); // Uses the class method
			const sidecarPath = this.getSidecarPath(file.path); // Uses the class method
			const initialSidecarExists = allFilePaths.has(sidecarPath);

			if (isMonitored) {
				let sidecarEnsuredThisIteration = initialSidecarExists;

				if (!initialSidecarExists) {
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

		// Phase 2: Clean up orphan or invalid sidecars
		const currentFilesAfterCreation = this.app.vault.getFiles();

		for (const file of currentFilesAfterCreation) {
			if (this.isSidecarFile(file.path)) { // Uses the class method
				const sourcePath = this.getSourcePathFromSidecar(file.path); // Uses the class method
				let shouldDelete = false;
				let reason = "";				if (!sourcePath) {
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
						if (!this.isMonitoredFile(sourcePath)) { // Uses the class method
							shouldDelete = true;
							reason = "main file no longer monitored";
						}
					}
				}

				if (shouldDelete) {
					try {
						const sidecarFileToDelete = this.app.vault.getAbstractFileByPath(file.path);
						if (sidecarFileToDelete instanceof TFile) {
							await this.app.vault.delete(sidecarFileToDelete);
							deletedOrphanCount++;
							console.log(`Sidecar Plugin: Deleted orphan sidecar ${file.path} because: ${reason}`);
						}
					} catch (error) {
						console.error(`Sidecar Plugin: Error deleting orphan sidecar ${file.path}: `, error);
					}
				}
			}
		}

		console.log(`Sidecar Plugin: Revalidation complete. Newly created sidecars: ${newlyCreatedSidecarCount}, Monitored files with sidecars: ${countMonitoredFilesWithSidecars}, Deleted orphans: ${deletedOrphanCount}`);
		new Notice(`Sidecar revalidation complete: ${newlyCreatedSidecarCount} created, ${countMonitoredFilesWithSidecars} monitored, ${deletedOrphanCount} orphans deleted.`);
	}

	// --- Utility Method Wrappers for Plugin Class ---
	// These methods now correctly call the imported utility functions,
	// passing the plugin's settings and providing the necessary context.

	isMonitoredFile(filePath: string): boolean {
		return isMonitoredFileUtil(filePath, this.settings, (fp) => {
			return this.isSidecarFile(fp) || this.isRedirectFile(fp);
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

	isRedirectFile(filePath: string): boolean {
		return isRedirectFileUtil(filePath, this.settings);
	}

	getRedirectFilePath(originalSourcePath: string): string {
		return getRedirectFilePathUtil(originalSourcePath, this.settings);
	}
	getSourcePathFromRedirectFile(redirectFilePath: string): string | null {
		return getSourcePathFromRedirectFileUtil(redirectFilePath, this.settings);
	}

	isRedirectFileManagementEnabled(): boolean {
		return isRedirectFileManagementEnabledUtil(this.settings);
	}
}
