import { loggerDebug, loggerWarn, initLogger, registerLoggerClass } from '@/utils';
import { Notice, Plugin, TFile } from 'obsidian';
import { OrphanSidecarModal } from '@/modals/OrphanSidecarModal';
import { SettingsManager } from '@/settings/SettingsManager';
import { DEFAULT_SETTINGS, SidecarPluginSettings, SidecarPluginInterface } from '@/types';
import { updateSidecarFileAppearance, updateSidecarCss } from '@/explorer-style';
import { VaultEventHandler } from '@/events';
import { SidecarManager } from '@/SidecarManager';
import { FilePathService, CommandService, MenuService } from '@/services';

export default class SidecarPlugin extends Plugin implements SidecarPluginInterface {
	sidecarAppearanceObserver?: MutationObserver;
	settings: SidecarPluginSettings;
	settingsManager: SettingsManager;
	sidecarManager: SidecarManager;
	vaultEventHandler: VaultEventHandler;
	
	// Services
	filePathService: FilePathService;
	commandService: CommandService;
	menuService: MenuService;

	public isInitialRevalidating = false;
	public hasFinishedInitialLoad = false;

	updateSidecarFileAppearance() {
		updateSidecarFileAppearance(this);
	}
	updateSidecarCss() {
		updateSidecarCss(this);
	}
	async onload() {
		loggerDebug(this, 'Plugin loading started');
		
		initLogger(this);
		registerLoggerClass(this, 'SidecarPlugin');
		this.settingsManager = new SettingsManager(this);
		registerLoggerClass(this.settingsManager, 'SettingsManager');
		await this.settingsManager.loadSettings();
		this.settings = this.settingsManager.getSettings();
		
		// Initialize services
		this.filePathService = new FilePathService(this.settings);
		registerLoggerClass(this.filePathService, 'FilePathService');
		
		this.commandService = new CommandService(this);
		registerLoggerClass(this.commandService, 'CommandService');
		
		this.menuService = new MenuService(this);
		registerLoggerClass(this.menuService, 'MenuService');
		
		this.isInitialRevalidating = this.settings.revalidateOnStartup;
		this.hasFinishedInitialLoad = false;

		this.sidecarManager = new SidecarManager(this);
		registerLoggerClass(this.sidecarManager, 'SidecarManager');

		this.vaultEventHandler = new VaultEventHandler(this, this.sidecarManager);
		registerLoggerClass(this.vaultEventHandler, 'VaultEventHandler');

		this.addSettingTab(this.settingsManager.getSettingTab());

		// Register services
		this.commandService.registerCommands();
		this.menuService.registerMenuHandlers();
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
			}));
			if (this.settings.revalidateOnStartup) {
				loggerDebug(this, 'Starting initial revalidation');
				this.isInitialRevalidating = true;
				try {
					await this.revalidateSidecars();
				} catch (error) {
					loggerWarn(this, 'Error during initial revalidation:', error);
				} finally {
					this.isInitialRevalidating = false;
					this.hasFinishedInitialLoad = true;
					loggerDebug(this, 'Initial revalidation completed');
				}			} else {
				this.hasFinishedInitialLoad = true;
				loggerDebug(this, 'Skipped initial revalidation, plugin ready');
			}
		});

		loggerDebug(this, 'Plugin loading completed');
	}
	onunload() {
		loggerDebug(this, 'Plugin unloading');
		if (this.sidecarAppearanceObserver) {
			this.sidecarAppearanceObserver.disconnect();
			this.sidecarAppearanceObserver = undefined;
		}
	}	async saveSettings(refreshStyles: boolean = true): Promise<void> {
		loggerDebug(this, 'Saving settings', { refreshStyles });
		await this.settingsManager.saveSettings();
		
		// Update service settings
		this.filePathService.updateSettings(this.settings);
		
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
							loggerDebug(this, `Deleted orphan sidecar ${orphanPath} because: ${orphanReasons[orphanPath]}`);
						}
					} catch (err) {
						loggerWarn(this, `Error deleting orphan sidecar ${orphanPath}`, { error: err });
					}
				}
				postDeletionCallback(actualDeletedCount);
				resolveOuterPromise(); // Resolve the promise after processing.
			}).open();
		});
	}
	async revalidateSidecars(): Promise<void> {
		loggerDebug(this, 'Starting sidecar revalidation');
		await this.sidecarManager.revalidateAllSidecars();
	}
	
	// Delegate to FilePathService
	isMonitoredFile(filePath: string): boolean {
		return this.filePathService.isMonitoredFile(filePath, (fp: string) => {
			return this.filePathService.isDerivativeFile(fp);
		});
	}

	getSidecarPath(filePath: string): string {
		return this.filePathService.getSidecarPath(filePath);
	}

	isSidecarFile(filePath: string): boolean {
		return this.filePathService.isSidecarFile(filePath);
	}
	
	getSourcePathFromSidecar(sidecarPath: string): string | null {
		return this.filePathService.getSourcePathFromSidecar(sidecarPath);
	}

	getRedirectPath(filePath: string): string {
		return this.filePathService.getRedirectPath(filePath);
	}

	isRedirectFile(filePath: string): boolean {
		return this.filePathService.isRedirectFile(filePath);
	}

	getSourcePathFromRedirect(redirectPath: string): string | null {
		return this.filePathService.getSourcePathFromRedirect(redirectPath);
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
