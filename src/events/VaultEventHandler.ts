import { TAbstractFile, TFile, Notice, App } from 'obsidian';
import { loggerDebug, loggerInfo, loggerWarn, loggerError } from '@/utils';
import type SidecarPlugin from '@/main';
import type { SidecarManager } from '@/SidecarManager';

export class VaultEventHandler {
	private plugin: SidecarPlugin;
	private app: App;
	private sidecarManager: SidecarManager;
	constructor(plugin: SidecarPlugin, sidecarManager: SidecarManager) {
		this.plugin = plugin;
		this.app = plugin.app;
		this.sidecarManager = sidecarManager;
	}

	async renameSidecarMainFile(oldSidecarPath: string, newSidecarPath: string): Promise<void> {
		loggerDebug(this, 'Processing sidecar rename - determining main file paths', { oldSidecarPath, newSidecarPath });

		const oldMainPath = this.plugin.getSourcePathFromSidecar(oldSidecarPath);
		if (!oldMainPath) {
			loggerWarn(this, 'Cannot determine old main file path for sidecar', { 
				sidecarPath: oldSidecarPath,
				reason: 'invalid sidecar path format'
			});
			return;
		}
		loggerDebug(this, 'Old main file path determined', { oldMainPath });

		const newMainPath = this.plugin.getSourcePathFromSidecar(newSidecarPath);
		if (!newMainPath) {
			loggerWarn(this, 'Cannot determine new main file path for sidecar', { 
				sidecarPath: newSidecarPath,
				reason: 'invalid sidecar path format'
			});
			return;
		}
		loggerDebug(this, 'New main file path determined', { newMainPath });

		const mainFile = this.app.vault.getAbstractFileByPath(oldMainPath);
		if (!mainFile || !(mainFile instanceof TFile)) {
			loggerDebug(this, 'Main file not found - skipping rename operation', { oldMainPath });
			return;
		}
		loggerDebug(this, 'Main file located successfully', { filePath: mainFile.path });

		const existingTargetFile = this.app.vault.getAbstractFileByPath(newMainPath);
		if (existingTargetFile) {
			loggerWarn(this, 'Target main file path already exists - cannot rename', { 
				newMainPath,
				fileName: newMainPath.split('/').pop()
			});
			new Notice(`Cannot rename main file: ${newMainPath.split('/').pop()} already exists`, 3000);
			return;
		}
		loggerDebug(this, 'Target path is available - proceeding with main file rename');

		try {
			loggerDebug(this, 'Renaming main file to match sidecar rename', { from: oldMainPath, to: newMainPath });
			await this.app.fileManager.renameFile(mainFile, newMainPath);
			
			loggerInfo(this, 'Main file successfully renamed to match sidecar', { 
				oldPath: oldMainPath,
				newPath: newMainPath,
				fileName: newMainPath.split('/').pop()
			});
			new Notice(`Also renamed main file to: ${newMainPath.split('/').pop()}`, 2000);
		} catch (renameError) {
			loggerError(this, 'Failed to rename main file', { 
				oldPath: oldMainPath,
				newPath: newMainPath,
				error: renameError instanceof Error ? renameError.message : String(renameError)
			});
			new Notice(`Error renaming main file to ${newMainPath.split('/').pop()}`, 3000);
		}
	}
	async handleExtensionReapplication(file: TFile, oldPath: string): Promise<boolean> {
		const newPath = file.path;
		loggerDebug(this, 'Checking if file rename requires extension reapplication', { oldPath, newPath });

		if (this.plugin.isSidecarFile(oldPath)) {
			loggerDebug(this, 'Old path was a sidecar file - analyzing rename pattern');
			const mainPath = this.plugin.getSourcePathFromSidecar(oldPath);
			if (mainPath) {
				loggerDebug(this, 'Main file path identified for old sidecar', { mainPath });
				const expectedNewSidecarPath = this.plugin.getSidecarPath(mainPath);
				loggerDebug(this, 'Expected new sidecar path calculated', { expectedNewSidecarPath });

				if (newPath !== expectedNewSidecarPath && !this.plugin.isSidecarFile(newPath)) {
					loggerDebug(this, 'Extension reapplication needed - reconstructing proper sidecar path');
					
					const newFileName = newPath.substring(newPath.lastIndexOf('/') + 1);
					const newFileNameWithoutMd = newFileName.endsWith('.md')
						? newFileName.slice(0, -3)
						: newFileName;
					const mainFileName = mainPath.substring(mainPath.lastIndexOf('/') + 1);
					const mainBaseName = mainFileName.lastIndexOf('.') !== -1
						? mainFileName.slice(0, mainFileName.lastIndexOf('.'))
						: mainFileName;
					const mainExtensions = mainFileName.substring(mainBaseName.length);
					const newBaseName = newFileNameWithoutMd.lastIndexOf('.') !== -1
						? newFileNameWithoutMd.slice(0, newFileNameWithoutMd.lastIndexOf('.'))
						: newFileNameWithoutMd;
					const directory = newPath.substring(0, newPath.lastIndexOf('/') + 1);
					const newSidecarPath = directory + newBaseName + mainExtensions + '.' + this.plugin.settings.sidecarSuffix + '.md';
					
					loggerDebug(this, 'Calculated proper sidecar path for restoration', { 
						originalName: newFileName,
						baseName: newBaseName,
						mainExtensions,
						restoredPath: newSidecarPath
					});

					try {
						loggerDebug(this, 'Restoring proper sidecar file extension');
						await this.app.fileManager.renameFile(file, newSidecarPath);
						
						loggerInfo(this, 'Sidecar extension successfully restored', { 
							from: newPath,
							to: newSidecarPath
						});
						
						loggerDebug(this, 'Processing corresponding main file rename');
						await this.renameSidecarMainFile(oldPath, newSidecarPath);
						return true;
					} catch (restoreError) {
						loggerError(this, 'Failed to restore sidecar extension', { 
							newPath,
							attemptedPath: newSidecarPath,
							error: restoreError instanceof Error ? restoreError.message : String(restoreError)
						});
					}
				} else {
					loggerDebug(this, 'No extension reapplication needed - rename is valid', { 
						pathsMatch: newPath === expectedNewSidecarPath,
						isStillSidecar: this.plugin.isSidecarFile(newPath)
					});
				}
			} else {
				loggerWarn(this, 'Could not determine main file path for old sidecar', { oldSidecarPath: oldPath });
			}
		} else {
			loggerDebug(this, 'Old path was not a sidecar file - no extension reapplication needed');
		}
		return false;
	}

	async handleFileCreate(file: TAbstractFile): Promise<void> {
		if (file instanceof TFile) {
			loggerDebug(this, 'Processing file creation event', { path: file.path, extension: file.extension });
			
			await this.sidecarManager.createSidecarForFile(file);

			if (this.plugin.isRedirectFile(file.path)) {
				loggerDebug(this, 'Redirect file created - updating sidecar appearance');
				this.plugin.updateSidecarFileAppearance();
			}
		}
	}

	async handleFileDelete(file: TAbstractFile): Promise<void> {
		if (file instanceof TFile) {
			loggerDebug(this, 'Processing file deletion event', { path: file.path });
			
			await this.sidecarManager.deleteSidecarForFile(file);

			if (this.plugin.isRedirectFile(file.path)) {
				loggerDebug(this, 'Redirect file deleted - updating sidecar appearance');
				this.plugin.updateSidecarFileAppearance();
			}
		}
	}

	async handleFileRename(file: TAbstractFile, oldPath: string): Promise<void> {
		if (file instanceof TFile) {
			const newPath = file.path;
			loggerDebug(this, 'Processing file rename event', { oldPath, newPath });

			const extensionWasReapplied = await this.handleExtensionReapplication(file, oldPath);
			loggerDebug(this, 'Extension reapplication check completed', { reapplied: extensionWasReapplied });

			if (extensionWasReapplied) {
				loggerDebug(this, 'Extension was reapplied - updating UI and completing rename handling');
				// After extension reapplication, also rename preview files
				loggerDebug(this, 'Processing preview file rename after extension reapplication', { oldPath, newPath });
				await this.sidecarManager.handlePreviewRename(oldPath, newPath);
				this.plugin.updateSidecarFileAppearance();
				return;
			}

			if (this.plugin.isSidecarFile(newPath)) {
				loggerDebug(this, 'Renamed file is a sidecar - processing sidecar rename logic');
				await this.renameSidecarMainFile(oldPath, newPath);

				const mainPath = this.plugin.getSourcePathFromSidecar(newPath);
				if (mainPath && !this.app.vault.getAbstractFileByPath(mainPath)) {
					loggerWarn(this, 'Sidecar is orphaned after rename - main file not found', { 
						sidecarPath: newPath,
						expectedMainPath: mainPath
					});
				}
				
				loggerDebug(this, 'Updating sidecar appearance after sidecar rename');
				this.plugin.updateSidecarFileAppearance();
				return;
			}

			loggerDebug(this, 'Renamed file is a main file - processing main file rename logic');
			// Rename associated sidecar file
			await this.sidecarManager.handleSidecarRename(file, oldPath, newPath);
			// Also rename associated preview files
			loggerDebug(this, 'Processing preview file rename after main file rename', { oldPath, newPath });
			await this.sidecarManager.handlePreviewRename(oldPath, newPath);

			loggerDebug(this, 'Updating sidecar appearance after main file rename');
			this.plugin.updateSidecarFileAppearance();
		}
	}
}
