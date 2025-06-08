import { TAbstractFile, TFile, Notice, App } from 'obsidian';
import { debug, info, warn, error } from '@/utils';
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

	initialize() {
		debug(this, 'Setting up vault event listeners - monitoring file system changes');
		
		debug(this, 'Registering file creation event handler');
		this.plugin.registerEvent(
			this.plugin.app.vault.on('create', this.handleFileCreate.bind(this))
		);

		debug(this, 'Registering file deletion event handler');
		this.plugin.registerEvent(
			this.plugin.app.vault.on('delete', this.handleFileDelete.bind(this))
		);

		debug(this, 'Registering file rename event handler');
		this.plugin.registerEvent(
			this.plugin.app.vault.on('rename', this.handleFileRename.bind(this))
		);

		debug(this, 'Vault event handler fully initialized - all file system events monitored');
	}

	cleanup() {
		debug(this, 'Cleaning up vault event handler - Obsidian will auto-unregister events');
	}
	async renameSidecarMainFile(oldSidecarPath: string, newSidecarPath: string): Promise<void> {
		debug(this, 'Processing sidecar rename - determining main file paths', { oldSidecarPath, newSidecarPath });

		const oldMainPath = this.plugin.getSourcePathFromSidecar(oldSidecarPath);
		if (!oldMainPath) {
			warn(this, 'Cannot determine old main file path for sidecar', { 
				sidecarPath: oldSidecarPath,
				reason: 'invalid sidecar path format'
			});
			return;
		}
		debug(this, 'Old main file path determined', { oldMainPath });

		const newMainPath = this.plugin.getSourcePathFromSidecar(newSidecarPath);
		if (!newMainPath) {
			warn(this, 'Cannot determine new main file path for sidecar', { 
				sidecarPath: newSidecarPath,
				reason: 'invalid sidecar path format'
			});
			return;
		}
		debug(this, 'New main file path determined', { newMainPath });

		const mainFile = this.app.vault.getAbstractFileByPath(oldMainPath);
		if (!mainFile || !(mainFile instanceof TFile)) {
			debug(this, 'Main file not found - skipping rename operation', { oldMainPath });
			return;
		}
		debug(this, 'Main file located successfully', { filePath: mainFile.path });

		const existingTargetFile = this.app.vault.getAbstractFileByPath(newMainPath);
		if (existingTargetFile) {
			warn(this, 'Target main file path already exists - cannot rename', { 
				newMainPath,
				fileName: newMainPath.split('/').pop()
			});
			new Notice(`Cannot rename main file: ${newMainPath.split('/').pop()} already exists`, 3000);
			return;
		}
		debug(this, 'Target path is available - proceeding with main file rename');

		try {
			debug(this, 'Renaming main file to match sidecar rename', { from: oldMainPath, to: newMainPath });
			await this.app.fileManager.renameFile(mainFile, newMainPath);
			
			info(this, 'Main file successfully renamed to match sidecar', { 
				oldPath: oldMainPath,
				newPath: newMainPath,
				fileName: newMainPath.split('/').pop()
			});
			new Notice(`Also renamed main file to: ${newMainPath.split('/').pop()}`, 2000);
		} catch (renameError) {
			error(this, 'Failed to rename main file', { 
				oldPath: oldMainPath,
				newPath: newMainPath,
				error: renameError instanceof Error ? renameError.message : String(renameError)
			});
			new Notice(`Error renaming main file to ${newMainPath.split('/').pop()}`, 3000);
		}
	}
	async handleExtensionReapplication(file: TFile, oldPath: string): Promise<boolean> {
		const newPath = file.path;
		debug(this, 'Checking if file rename requires extension reapplication', { oldPath, newPath });

		if (this.plugin.isSidecarFile(oldPath)) {
			debug(this, 'Old path was a sidecar file - analyzing rename pattern');
			const mainPath = this.plugin.getSourcePathFromSidecar(oldPath);
			if (mainPath) {
				debug(this, 'Main file path identified for old sidecar', { mainPath });
				const expectedNewSidecarPath = this.plugin.getSidecarPath(mainPath);
				debug(this, 'Expected new sidecar path calculated', { expectedNewSidecarPath });

				if (newPath !== expectedNewSidecarPath && !this.plugin.isSidecarFile(newPath)) {
					debug(this, 'Extension reapplication needed - reconstructing proper sidecar path');
					
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
					
					debug(this, 'Calculated proper sidecar path for restoration', { 
						originalName: newFileName,
						baseName: newBaseName,
						mainExtensions,
						restoredPath: newSidecarPath
					});

					try {
						debug(this, 'Restoring proper sidecar file extension');
						await this.app.fileManager.renameFile(file, newSidecarPath);
						
						info(this, 'Sidecar extension successfully restored', { 
							from: newPath,
							to: newSidecarPath
						});
						
						debug(this, 'Processing corresponding main file rename');
						await this.renameSidecarMainFile(oldPath, newSidecarPath);
						return true;
					} catch (restoreError) {
						error(this, 'Failed to restore sidecar extension', { 
							newPath,
							attemptedPath: newSidecarPath,
							error: restoreError instanceof Error ? restoreError.message : String(restoreError)
						});
					}
				} else {
					debug(this, 'No extension reapplication needed - rename is valid', { 
						pathsMatch: newPath === expectedNewSidecarPath,
						isStillSidecar: this.plugin.isSidecarFile(newPath)
					});
				}
			} else {
				warn(this, 'Could not determine main file path for old sidecar', { oldSidecarPath: oldPath });
			}
		} else {
			debug(this, 'Old path was not a sidecar file - no extension reapplication needed');
		}
		return false;
	}

	async handleFileCreate(file: TAbstractFile): Promise<void> {
		if (file instanceof TFile) {
			debug(this, 'Processing file creation event', { path: file.path, extension: file.extension });
			
			await this.sidecarManager.createSidecarForFile(file);

			if (this.plugin.isRedirectFile(file.path)) {
				debug(this, 'Redirect file created - updating sidecar appearance');
				this.plugin.updateSidecarFileAppearance();
			}
		}
	}

	async handleFileDelete(file: TAbstractFile): Promise<void> {
		if (file instanceof TFile) {
			debug(this, 'Processing file deletion event', { path: file.path });
			
			await this.sidecarManager.deleteSidecarForFile(file);

			if (this.plugin.isRedirectFile(file.path)) {
				debug(this, 'Redirect file deleted - updating sidecar appearance');
				this.plugin.updateSidecarFileAppearance();
			}
		}
	}

	async handleFileRename(file: TAbstractFile, oldPath: string): Promise<void> {
		if (file instanceof TFile) {
			const newPath = file.path;
			debug(this, 'Processing file rename event', { oldPath, newPath });

			const extensionWasReapplied = await this.handleExtensionReapplication(file, oldPath);
			debug(this, 'Extension reapplication check completed', { reapplied: extensionWasReapplied });

			if (extensionWasReapplied) {
				debug(this, 'Extension was reapplied - updating UI and completing rename handling');
				this.plugin.updateSidecarFileAppearance();
				return;
			}

			if (this.plugin.isSidecarFile(newPath)) {
				debug(this, 'Renamed file is a sidecar - processing sidecar rename logic');
				await this.renameSidecarMainFile(oldPath, newPath);

				const mainPath = this.plugin.getSourcePathFromSidecar(newPath);
				if (mainPath && !this.app.vault.getAbstractFileByPath(mainPath)) {
					warn(this, 'Sidecar is orphaned after rename - main file not found', { 
						sidecarPath: newPath,
						expectedMainPath: mainPath
					});
				}
				
				debug(this, 'Updating sidecar appearance after sidecar rename');
				this.plugin.updateSidecarFileAppearance();
				return;
			}

			debug(this, 'Renamed file is a main file - processing main file rename logic');
			await this.sidecarManager.handleSidecarRename(file, oldPath, newPath);

			debug(this, 'Updating sidecar appearance after main file rename');
			this.plugin.updateSidecarFileAppearance();
		}
	}
}
