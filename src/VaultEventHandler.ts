import { warn, debug, registerLoggerClass } from './utils/obsidian-logger';
import { TAbstractFile, TFile, Notice, App } from 'obsidian'; // Added App
import type SidecarPlugin from './main';
import type { SidecarManager } from './SidecarManager'; // Import SidecarManager type

export class VaultEventHandler {
	private plugin: SidecarPlugin;
	private app: App;
	private sidecarManager: SidecarManager;

	constructor(plugin: SidecarPlugin, sidecarManager: SidecarManager) {
		this.plugin = plugin;
		this.app = plugin.app;
		this.sidecarManager = sidecarManager;
	}

	/**
	 * Renames the main file when a sidecar file is renamed
	 */
	async renameSidecarMainFile(oldSidecarPath: string, newSidecarPath: string): Promise<void> {
		debug(this, `oldSidecarPath="${oldSidecarPath}", newSidecarPath="${newSidecarPath}"`);

		const oldMainPath = this.plugin.getSourcePathFromSidecar(oldSidecarPath);
		if (!oldMainPath) {
			debug(this, `Cannot determine old main path for sidecar: ${oldSidecarPath}`);
			warn(this, `Sidecar Plugin: Cannot determine main file path for old sidecar: ${oldSidecarPath}`);
			return;
		}
		debug(this, `Old main path determined: ${oldMainPath}`);

		const newMainPath = this.plugin.getSourcePathFromSidecar(newSidecarPath);
		if (!newMainPath) {
			debug(this, `Cannot determine new main path for sidecar: ${newSidecarPath}`);
			warn(this, `Sidecar Plugin: Cannot determine main file path for new sidecar: ${newSidecarPath}`);
			return;
		}
		debug(this, `New main path determined: ${newMainPath}`);
		const mainFile = this.app.vault.getAbstractFileByPath(oldMainPath);
		if (!mainFile || !(mainFile instanceof TFile)) {
			debug(this, `Main file not found at ${oldMainPath}, skipping rename`);
			return;
		}
		debug(this, `Main file found: ${mainFile.path}`);

		const existingTargetFile = this.app.vault.getAbstractFileByPath(newMainPath);
		if (existingTargetFile) {
			debug(this, `Target main path ${newMainPath} already exists, cannot rename`);
			warn(this, `Sidecar Plugin: Target main path ${newMainPath} already exists, skipping rename`);
			new Notice(`Cannot rename main file: ${newMainPath.split('/').pop()} already exists`, 3000);
			return;
		}
		debug(this, `Target path is available, proceeding with rename`);

		try {
			debug(this, `Attempting to rename main file from ${oldMainPath} to ${newMainPath}`);
			await this.app.fileManager.renameFile(mainFile, newMainPath);
			debug(this, `Successfully renamed main file to ${newMainPath}`);
			new Notice(`Also renamed main file to: ${newMainPath.split('/').pop()}`, 2000);
		} catch (error) {
			error(this, `Error renaming main file from ${oldMainPath} to ${newMainPath}:`, error);
			new Notice(`Error renaming main file to ${newMainPath.split('/').pop()}`, 3000);
		}
	}

	/**
	 * Checks if a file was renamed to just the base name and needs extensions re-applied
	 */
	async handleExtensionReapplication(file: TFile, oldPath: string): Promise<boolean> {
		const newPath = file.path;
		debug(this, `handleExtensionReapplication called: oldPath="${oldPath}", newPath="${newPath}"`);

		if (this.plugin.isSidecarFile(oldPath)) {
			debug(this, `Old path was a sidecar file`);
			const mainPath = this.plugin.getSourcePathFromSidecar(oldPath);
			if (mainPath) {
				debug(this, `Main path for old sidecar: ${mainPath}`);
				const expectedNewSidecarPath = this.plugin.getSidecarPath(mainPath);
				debug(this, `Expected new sidecar path: ${expectedNewSidecarPath}`);
				if (newPath !== expectedNewSidecarPath && !this.plugin.isSidecarFile(newPath)) {
					debug(this, `Extension reapplication needed - new path missing sidecar extensions`);
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
					debug(this, `Calculated restoration path: ${newSidecarPath}`);
					try {
						debug(this, `Attempting to restore sidecar extension from ${newPath} to ${newSidecarPath}`);
						await this.app.fileManager.renameFile(file, newSidecarPath);
						debug(this, `Successfully restored sidecar extension`);
						await this.renameSidecarMainFile(oldPath, newSidecarPath);
						return true;
					} catch (error) {
						debug(this, `Error restoring sidecar extension for ${newPath}:`, error);
						console.error(`Sidecar Plugin: Error restoring sidecar extension for ${newPath}:`, error);
					}
				} else {
					debug(this, `No extension reapplication needed - paths match or new path is already a sidecar`);
				}
			} else {
				debug(this, `Could not determine main path for old sidecar`);
			}
		} else {
			debug(this, `Old path was not a sidecar file`);
		}
		return false;
	}

	async handleFileCreate(file: TAbstractFile): Promise<void> {
		if (file instanceof TFile) {
			await this.sidecarManager.createSidecarForFile(file);

			if (this.plugin.isRedirectFile(file.path)) {
				this.plugin.updateSidecarFileAppearance();
			}
		}
	}

	async handleFileDelete(file: TAbstractFile): Promise<void> {
		if (file instanceof TFile) {
			await this.sidecarManager.deleteSidecarForFile(file);

			if (this.plugin.isRedirectFile(file.path)) {
				this.plugin.updateSidecarFileAppearance();
			}
		}
	}

	async handleFileRename(file: TAbstractFile, oldPath: string): Promise<void> {
		if (file instanceof TFile) {
			const newPath = file.path;
			debug(this, `handleFileRename called: oldPath="${oldPath}", newPath="${newPath}"`);

			const extensionWasReapplied = await this.handleExtensionReapplication(file, oldPath);
			debug(this, `Extension reapplication result: ${extensionWasReapplied}`);

			if (extensionWasReapplied) {
				debug(this, `Extension was reapplied, updating UI and exiting early`);
				this.plugin.updateSidecarFileAppearance();
				return;
			}

			if (this.plugin.isSidecarFile(newPath)) {
				debug(this, `New path is a sidecar file, handling sidecar rename`);
				await this.renameSidecarMainFile(oldPath, newPath);

				const mainPath = this.plugin.getSourcePathFromSidecar(newPath);
				if (mainPath && !this.app.vault.getAbstractFileByPath(mainPath)) {
					debug(this, `Sidecar is orphaned - main file ${mainPath} not found`);
					warn(this, `Sidecar Plugin: Renamed sidecar ${newPath} is an orphan. Main file ${mainPath} not found.`);
				}
				this.plugin.updateSidecarFileAppearance();
				debug(this, `Sidecar rename handling complete`);
				return;
			}
			debug(this, `New path is not a sidecar, handling main file rename`);
			await this.sidecarManager.handleSidecarRename(file, oldPath, newPath);

			this.plugin.updateSidecarFileAppearance();
			debug(this, `Main file rename handling complete`);
		}
	}
}
