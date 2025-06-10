import { TFile, Notice, App } from 'obsidian';
import { getBasename } from '@/utils';
import { loggerDebug, loggerWarn, loggerError, loggerInfo } from '@/utils';
import type SidecarPlugin from '@/main';

// Track sidecars recently restored to ignore subsequent delete events
const recentlyRestoredSidecars = new Set<string>();

export class SidecarManager {
	private plugin: SidecarPlugin;
	private app: App;
	private recentlyRestoredSidecars = new Set<string>();

	constructor(plugin: SidecarPlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
		loggerDebug(this, 'SidecarManager initialized');
	}
	async createSidecarForFile(file: TFile, force = false): Promise<void> {
		loggerDebug(this, 'Creating sidecar for file', { path: file.path, force });

		if (!this.plugin.hasFinishedInitialLoad && !this.plugin.settings.revalidateOnStartup) {
			loggerWarn(this, 'Skipping sidecar creation - initial load not finished and revalidateOnStartup is false');
			return;
		}
		
		if (this.plugin.isInitialRevalidating) {
			loggerWarn(this, 'Skipping sidecar creation - initial revalidation in progress');
			return;
		}

		const monitored = this.plugin.isMonitoredFile(file.path);
		loggerDebug(this, 'File monitoring status', { monitored });
		
		if (monitored) {
			const shouldCreate = force || (this.plugin.settings.autoCreateSidecars ?? true);
			loggerDebug(this, 'Sidecar creation decision', { shouldCreate, force, autoCreateSidecars: this.plugin.settings.autoCreateSidecars });
			
			if (shouldCreate) {
				const sidecarPath = this.plugin.getSidecarPath(file.path);
				loggerDebug(this, 'Sidecar path calculated', { sidecarPath });
				
				if (!this.app.vault.getAbstractFileByPath(sidecarPath)) {
					try {
						loggerDebug(this, 'Creating sidecar file', { path: sidecarPath });
						await this.app.vault.create(sidecarPath, '');
						loggerInfo(this, 'Sidecar created successfully', { path: sidecarPath });
						new Notice(`Created sidecar: ${sidecarPath.split('/').pop()}`);
						
						if (typeof this.plugin.updateSidecarFileAppearance === 'function') {
							setTimeout(() => this.plugin.updateSidecarFileAppearance(), 50);
						}
					} catch (err) {
						if (String(err).includes('File already exists')) {
							loggerWarn(this, 'Sidecar already exists, ignoring error', { path: sidecarPath });
							return;
						}
						loggerError(this, 'Error creating sidecar', { path: sidecarPath, error: err });
						new Notice(`Error creating sidecar for ${file.name}`);
					}
				} else {
					loggerWarn(this, 'Sidecar already exists', { path: sidecarPath });
				}
			}
		}
	}
	async deleteSidecarForFile(file: TFile): Promise<void> {
		loggerDebug(this, 'Deleting sidecar for file', { path: file.path });

		if (this.recentlyRestoredSidecars.has(file.path)) {
			loggerDebug(this, 'Ignoring delete for recently restored sidecar', { path: file.path });
			this.recentlyRestoredSidecars.delete(file.path);
			return;
		}

		if (this.plugin.isSidecarFile(file.path)) {
			loggerDebug(this, 'File is a sidecar itself, ignoring delete');
			return;
		}

		if (!this.plugin.isMonitoredFile(file.path)) {
			loggerDebug(this, 'File is not monitored, ignoring delete');
			return;
		}

		const sidecarPath = this.plugin.getSidecarPath(file.path);
		const sidecarFile = this.app.vault.getAbstractFileByPath(sidecarPath);
		loggerDebug(this, 'Sidecar lookup', { sidecarPath, found: !!sidecarFile });

		if (sidecarFile instanceof TFile) {
			try {
				loggerDebug(this, 'Deleting sidecar file', { path: sidecarPath });
				await this.app.fileManager.trashFile(sidecarFile);
				loggerInfo(this, 'Sidecar deleted successfully', { path: sidecarPath });
				new Notice(`Deleted sidecar: ${sidecarPath.split('/').pop()}`);
			} catch (err) {
				loggerError(this, 'Error deleting sidecar file', { path: sidecarPath, error: err });
				new Notice(`Error deleting sidecar for ${file.name}`);
			}
		} else {
			loggerDebug(this, 'No sidecar file found to delete');
		}
	}
	async deleteAllSidecars(): Promise<void> {
		loggerDebug(this, 'Starting deletion of all sidecars');
		
		const allFiles = this.app.vault.getFiles();
		const sidecarFiles = allFiles.filter(file => this.plugin.isSidecarFile(file.path));
		
		loggerDebug(this, 'Found sidecars to delete', { count: sidecarFiles.length });
		
		let deletedCount = 0;
		for (const sidecarFile of sidecarFiles) {
			try {
				await this.app.fileManager.trashFile(sidecarFile);
				deletedCount++;
				loggerDebug(this, 'Deleted sidecar', { path: sidecarFile.path });
			} catch (err) {
				loggerError(this, 'Error deleting sidecar', { path: sidecarFile.path, error: err });
			}
		}
		
		loggerInfo(this, 'Sidecar deletion complete', { total: sidecarFiles.length, deleted: deletedCount });
		new Notice(`Deleted ${deletedCount} of ${sidecarFiles.length} sidecar files`);
	}
	async handleSidecarRename(file: TFile, oldPath: string, newPath: string): Promise<void> {
		loggerDebug(this, 'Handling sidecar rename', { oldPath, newPath });

		const oldSidecarPath = this.plugin.getSidecarPath(oldPath);
		const oldSidecarFile = this.app.vault.getAbstractFileByPath(oldSidecarPath);
		loggerDebug(this, 'Old sidecar lookup', { oldSidecarPath, found: !!oldSidecarFile });

		if (oldSidecarFile instanceof TFile) {
			loggerDebug(this, 'Found old sidecar file, proceeding with rename');
			const newSidecarPath = this.plugin.getSidecarPath(newPath);
			loggerDebug(this, 'New sidecar path calculated', { newSidecarPath });
			
			try {
				const existingNewSidecar = this.app.vault.getAbstractFileByPath(newSidecarPath);
				loggerDebug(this, 'Existing file check', { existingNewSidecar: !!existingNewSidecar });
				
				if (existingNewSidecar && existingNewSidecar.path !== oldSidecarFile.path) {
					loggerWarn(this, 'Target sidecar path already exists', { newSidecarPath });
					new Notice(`Sidecar for ${getBasename(newPath)} already exists. Old sidecar not moved.`, 3000);
				} else if (!existingNewSidecar || existingNewSidecar.path === oldSidecarFile.path) {
					loggerDebug(this, 'Target path is available, proceeding with rename');
					await this.app.fileManager.renameFile(oldSidecarFile, newSidecarPath);
					loggerInfo(this, 'Sidecar renamed successfully', { from: oldSidecarPath, to: newSidecarPath });
				}
			} catch (err) {
				loggerError(this, 'Error moving sidecar', { from: oldSidecarPath, to: newSidecarPath, error: err });
				new Notice(`Error moving sidecar for ${getBasename(newPath)}`, 3000);
			}
		} else {
			loggerDebug(this, 'No old sidecar found, checking if new file should have a sidecar');
			if (this.plugin.isMonitoredFile(newPath) && !this.plugin.isSidecarFile(newPath)) {
				loggerDebug(this, 'New file is monitored and not a sidecar, creating new sidecar');
				const newSidecarPath = this.plugin.getSidecarPath(newPath);
				const existingSidecar = this.app.vault.getAbstractFileByPath(newSidecarPath);
				loggerDebug(this, 'Existing sidecar check', { newSidecarPath, exists: !!existingSidecar });
				
				if (!existingSidecar) {
					try {
						loggerDebug(this, 'Creating new sidecar', { path: newSidecarPath });
						await this.app.vault.create(newSidecarPath, '');
						loggerInfo(this, 'New sidecar created', { path: newSidecarPath });
						new Notice(`Created sidecar: ${newSidecarPath.split('/').pop()}`);
					} catch (err) {
						loggerError(this, 'Error creating new sidecar', { path: newSidecarPath, error: err });
						new Notice(`Error creating sidecar for ${getBasename(newPath)}`);
					}
				} else {
					loggerDebug(this, 'Sidecar already exists, not creating');
				}
			} else {
				loggerDebug(this, 'New file is not monitored or is already a sidecar, no action needed');
			}
		}
	}
	async revalidateAllSidecars(): Promise<void> {
		loggerDebug(this, 'Starting sidecar revalidation');
		new Notice(`Starting sidecar revalidation...`, 3000);

		let newlyCreatedSidecarCount = 0;
		let countMonitoredFilesWithSidecars = 0;
		let deletedOrphanCount = 0;

		const allFiles = this.app.vault.getFiles();
		const allFilePaths = new Set(allFiles.map(f => f.path));
		loggerDebug(this, 'Revalidation scope', { totalFiles: allFiles.length });

		// Phase 1: Ensure monitored files have sidecars
		for (const file of allFiles) {
			const isMonitored = this.plugin.isMonitoredFile(file.path);
			const sidecarPath = this.plugin.getSidecarPath(file.path);
			const initialSidecarExists = allFilePaths.has(sidecarPath);

			if (isMonitored) {
				let sidecarEnsuredThisIteration = initialSidecarExists;

				if (!initialSidecarExists && (this.plugin.settings.autoCreateSidecars ?? true)) {
					try {
						loggerDebug(this, 'Creating missing sidecar during revalidation', { filePath: file.path, sidecarPath });
						await this.app.vault.create(sidecarPath, '');
						newlyCreatedSidecarCount++;
						allFilePaths.add(sidecarPath);
						sidecarEnsuredThisIteration = true;
					} catch (err) {
						if (String(err).includes('File already exists')) {
							sidecarEnsuredThisIteration = true;
							if (!allFilePaths.has(sidecarPath)) allFilePaths.add(sidecarPath);
						} else {
							loggerError(this, 'Error creating sidecar during revalidation', { filePath: file.path, sidecarPath, error: err });
						}
					}
				}
				if (sidecarEnsuredThisIteration) {
					countMonitoredFilesWithSidecars++;
				}
			}
		}

		loggerInfo(this, 'Phase 1 complete - sidecars created', { newlyCreated: newlyCreatedSidecarCount, monitoredWithSidecars: countMonitoredFilesWithSidecars });

		// Phase 2: Clean up orphan or invalid sidecars
		const currentFilesAfterCreation = this.app.vault.getFiles();
		const orphanSidecarsToModal: string[] = [];
		const orphanReasons: Record<string, string> = {};

		for (const file of currentFilesAfterCreation) {
			if (this.plugin.isSidecarFile(file.path)) {
				const sourcePath = this.plugin.getSourcePathFromSidecar(file.path);
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
						if (!this.plugin.isMonitoredFile(sourcePath)) {
							shouldDelete = true;
							reason = "main file no longer monitored";
						}
					}
				}

				if (shouldDelete) {
					orphanSidecarsToModal.push(file.path);
					orphanReasons[file.path] = reason;
				}
			}
		}

		loggerDebug(this, 'Phase 2 complete - orphans identified', { orphanCount: orphanSidecarsToModal.length });

		if (orphanSidecarsToModal.length > 0 && typeof this.plugin.showOrphanModal === 'function') {
			loggerDebug(this, 'Showing orphan modal');
			await this.plugin.showOrphanModal(orphanSidecarsToModal, orphanReasons, (deletedCount: number) => {
				deletedOrphanCount = deletedCount;
				new Notice(`Sidecar revalidation complete: ${newlyCreatedSidecarCount} created, ${countMonitoredFilesWithSidecars} monitored, ${deletedOrphanCount} orphans deleted.`);
				loggerInfo(this, 'Revalidation complete', { created: newlyCreatedSidecarCount, monitored: countMonitoredFilesWithSidecars, deleted: deletedOrphanCount });
			});
		} else {
			new Notice(`Sidecar revalidation complete: ${newlyCreatedSidecarCount} created, ${countMonitoredFilesWithSidecars} monitored, ${deletedOrphanCount} orphans deleted.`);
			loggerInfo(this, 'Revalidation complete - no orphans', { created: newlyCreatedSidecarCount, monitored: countMonitoredFilesWithSidecars });
		}
	}
	public addRecentlyRestored(path: string): void {
		loggerDebug(this, 'Adding to recently restored set', { path });
		this.recentlyRestoredSidecars.add(path);
	}

	public clearRecentlyRestored(path: string): void {
		loggerDebug(this, 'Removing from recently restored set', { path });
		this.recentlyRestoredSidecars.delete(path);
	}
}
