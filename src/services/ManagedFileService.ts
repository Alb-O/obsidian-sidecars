import { TFile } from "obsidian";
import type { App } from "obsidian";
import { loggerDebug, loggerInfo, loggerWarn, loggerError } from "@/utils";
import type SidecarPlugin from "@/main";
import type { FilePathService } from "./FilePathService";

export type ManagedFileType = "sidecar" | "preview" | "redirect";

export interface ManagedFileRelationship {
	mainFile: string;
	managedFile: string;
	type: ManagedFileType;
	extension?: string; // For preview files
}

/**
 * Efficient service for managing relationships between main files and their managed files
 * (sidecars, previews, redirects). Uses indexed maps for O(1) lookups instead of scanning.
 */
export class ManagedFileService {
	private plugin: SidecarPlugin;
	private app: App;
	private filePathService: FilePathService;

	// Efficient bidirectional indexes for O(1) lookups
	private mainToManaged = new Map<string, ManagedFileRelationship[]>(); // main file -> managed files
	private managedToMain = new Map<string, ManagedFileRelationship>(); // managed file -> main file
	private managedFilesByType = new Map<ManagedFileType, Set<string>>(); // type -> managed files

	// Cache for expensive operations
	private pathCache = new Map<
		string,
		{ sidecar?: string; preview?: Map<string, string>; redirect?: string }
	>();

	constructor(plugin: SidecarPlugin, filePathService: FilePathService) {
		this.plugin = plugin;
		this.app = plugin.app;
		this.filePathService = filePathService;

		// Initialize type sets
		this.managedFilesByType.set("sidecar", new Set());
		this.managedFilesByType.set("preview", new Set());
		this.managedFilesByType.set("redirect", new Set());

		loggerDebug(this, "ManagedFileService initialized with indexed maps");
	}

	/**
	 * Build initial index from existing files (called once on startup)
	 */
	async buildInitialIndex(): Promise<void> {
		loggerDebug(this, "Building initial managed file index");
		const startTime = Date.now();

		const allFiles = this.app.vault.getFiles();
		let indexedCount = 0;

		for (const file of allFiles) {
			if (this.indexManagedFile(file.path)) {
				indexedCount++;
			}
		}

		const duration = Date.now() - startTime;
		loggerInfo(this, "Initial index built", {
			totalFiles: allFiles.length,
			indexedManagedFiles: indexedCount,
			duration: `${duration}ms`,
		});
	}

	/**
	 * Index a single file if it's a managed file type
	 */
	private indexManagedFile(filePath: string): boolean {
		// Check if it's a sidecar
		if (this.filePathService.isSidecarFile(filePath)) {
			const mainPath = this.filePathService.getSourcePathFromSidecar(filePath);
			if (mainPath) {
				this.addRelationship(mainPath, filePath, "sidecar");
				return true;
			}
		}

		// Check if it's a preview file
		const previewInfo = this.filePathService.getPreviewFileInfo(filePath);
		if (previewInfo) {
			this.addRelationship(
				previewInfo.mainPath,
				filePath,
				"preview",
				previewInfo.extension,
			);
			return true;
		}

		// Check if it's a redirect file
		const redirectMainPath =
			this.filePathService.getMainPathFromRedirect(filePath);
		if (redirectMainPath) {
			this.addRelationship(redirectMainPath, filePath, "redirect");
			return true;
		}

		return false;
	}

	/**
	 * Add a relationship to the indexes
	 */
	private addRelationship(
		mainPath: string,
		managedPath: string,
		type: ManagedFileType,
		extension?: string,
	): void {
		const relationship: ManagedFileRelationship = {
			mainFile: mainPath,
			managedFile: managedPath,
			type,
			extension,
		};

		// Add to main -> managed index
		if (!this.mainToManaged.has(mainPath)) {
			this.mainToManaged.set(mainPath, []);
		}
		const managedList = this.mainToManaged.get(mainPath);
		if (managedList) {
			managedList.push(relationship);
		}

		// Add to managed -> main index
		this.managedToMain.set(managedPath, relationship);

		// Add to type index
		const typeSet = this.managedFilesByType.get(type);
		if (typeSet) {
			typeSet.add(managedPath);
		}

		// Clear cache for this main file
		this.pathCache.delete(mainPath);

		loggerDebug(this, `Indexed ${type} relationship`, {
			mainPath,
			managedPath,
			extension,
		});
	}

	/**
	 * Remove a relationship from the indexes
	 */
	private removeRelationship(managedPath: string): void {
		const relationship = this.managedToMain.get(managedPath);
		if (!relationship) return;

		const { mainFile, type } = relationship;

		// Remove from main -> managed index
		const managedList = this.mainToManaged.get(mainFile);
		if (managedList) {
			const index = managedList.findIndex((r) => r.managedFile === managedPath);
			if (index !== -1) {
				managedList.splice(index, 1);
				if (managedList.length === 0) {
					this.mainToManaged.delete(mainFile);
				}
			}
		}

		// Remove from managed -> main index
		this.managedToMain.delete(managedPath);

		// Remove from type index
		this.managedFilesByType.get(type)?.delete(managedPath);

		// Clear cache for this main file
		this.pathCache.delete(mainFile);

		loggerDebug(this, `Removed ${type} relationship`, {
			mainFile,
			managedPath,
		});
	}

	/**
	 * Handle file creation - add to index if it's a managed file
	 */
	onFileCreated(file: TFile): void {
		this.indexManagedFile(file.path);
	}

	/**
	 * Handle file deletion - remove from index
	 */
	onFileDeleted(path: string): void {
		this.removeRelationship(path);
	}

	/**
	 * Handle file rename - update indexes efficiently
	 */
	onFileRenamed(file: TFile, oldPath: string): void {
		const newPath = file.path;

		// Remove old relationship if it existed
		this.removeRelationship(oldPath);

		// Add new relationship if applicable
		this.indexManagedFile(newPath);

		// Handle main file renames - update all managed files
		const managedFiles = this.mainToManaged.get(oldPath);
		if (managedFiles) {
			this.handleMainFileRename(newPath, managedFiles);
		}
	}

	/**
	 * Handle when a main file is renamed - rename all its managed files
	 */
	private async handleMainFileRename(
		newMainPath: string,
		managedFiles: ManagedFileRelationship[],
	): Promise<void> {
		loggerDebug(this, "Handling main file rename", {
			newMainPath,
			managedFileCount: managedFiles.length,
		});

		// Update the index first
		// Find the old main path by looking at the first relationship
		const oldMainPath = managedFiles.length > 0 ? managedFiles[0].mainFile : "";
		this.mainToManaged.delete(oldMainPath);
		this.mainToManaged.set(newMainPath, managedFiles);

		// Update each relationship
		for (const relationship of managedFiles) {
			relationship.mainFile = newMainPath;
		}

		// Clear cache
		this.pathCache.delete(oldMainPath);
		this.pathCache.delete(newMainPath);

		// Rename each managed file
		for (const relationship of managedFiles) {
			await this.renameManagedFile(relationship, newMainPath);
		}
	}

	/**
	 * Rename a managed file to match its main file's new path
	 */
	private async renameManagedFile(
		relationship: ManagedFileRelationship,
		newMainPath: string,
	): Promise<void> {
		const { managedFile, type, extension } = relationship;
		const file = this.app.vault.getAbstractFileByPath(managedFile);

		if (!(file instanceof TFile)) {
			loggerWarn(this, `Managed file not found for rename`, {
				managedFile,
				type,
			});
			return;
		}

		let newManagedPath: string;

		switch (type) {
			case "sidecar":
				newManagedPath = this.filePathService.getSidecarPath(newMainPath);
				break;
			case "preview":
				if (!extension) {
					loggerError(this, "Extension is required for preview file rename", {
						relationship,
						newMainPath,
					});
					return;
				}
				newManagedPath = this.filePathService.getPreviewPath(
					newMainPath,
					extension,
				);
				break;
			case "redirect":
				newManagedPath = this.filePathService.getRedirectPath(newMainPath);
				break;
			default:
				loggerError(this, `Unknown managed file type: ${type}`);
				return;
		}

		// Check if target path already exists
		const existingFile = this.app.vault.getAbstractFileByPath(newManagedPath);
		if (existingFile && existingFile.path !== managedFile) {
			loggerWarn(this, `Target path already exists for ${type} file`, {
				oldPath: managedFile,
				newPath: newManagedPath,
			});
			return;
		}

		try {
			await this.app.fileManager.renameFile(file, newManagedPath);

			// Update the relationship
			relationship.managedFile = newManagedPath;
			this.managedToMain.set(newManagedPath, relationship);
			this.managedToMain.delete(managedFile);

			// Update type index
			const typeSet = this.managedFilesByType.get(type);
			if (typeSet) {
				typeSet.delete(managedFile);
			}
			const typeSetNew = this.managedFilesByType.get(type);
			if (typeSetNew) {
				typeSetNew.add(newManagedPath);
			}

			loggerInfo(this, `Renamed ${type} file`, {
				from: managedFile,
				to: newManagedPath,
			});
		} catch (error) {
			loggerError(this, `Failed to rename ${type} file`, {
				from: managedFile,
				to: newManagedPath,
				error,
			});
		}
	}

	/**
	 * Get all managed files for a main file (O(1) lookup)
	 */
	getManagedFiles(mainPath: string): ManagedFileRelationship[] {
		return this.mainToManaged.get(mainPath) || [];
	}

	/**
	 * Get managed files of a specific type for a main file
	 */
	getManagedFilesByType(
		mainPath: string,
		type: ManagedFileType,
	): ManagedFileRelationship[] {
		const managedFiles = this.mainToManaged.get(mainPath) || [];
		return managedFiles.filter((f) => f.type === type);
	}

	/**
	 * Get the main file for a managed file (O(1) lookup)
	 */
	getMainFile(managedPath: string): string | null {
		return this.managedToMain.get(managedPath)?.mainFile || null;
	}

	/**
	 * Check if a file is a managed file (O(1) lookup)
	 */
	isManagedFile(path: string): boolean {
		return this.managedToMain.has(path);
	}

	/**
	 * Get all managed files of a specific type
	 */
	getAllManagedFilesByType(type: ManagedFileType): string[] {
		return Array.from(this.managedFilesByType.get(type) || []);
	}

	/**
	 * Create a managed file for a main file
	 */
	async createManagedFile(
		mainPath: string,
		type: ManagedFileType,
		extension?: string,
	): Promise<boolean> {
		let managedPath: string;

		switch (type) {
			case "sidecar":
				managedPath = this.filePathService.getSidecarPath(mainPath);
				break;
			case "preview":
				if (!extension) {
					loggerError(this, "Extension required for preview file creation");
					return false;
				}
				managedPath = this.filePathService.getPreviewPath(mainPath, extension);
				break;
			case "redirect":
				managedPath = this.filePathService.getRedirectPath(mainPath);
				break;
			default:
				loggerError(this, `Unknown managed file type: ${type}`);
				return false;
		}

		// Check if already exists
		if (this.app.vault.getAbstractFileByPath(managedPath)) {
			loggerDebug(this, `${type} file already exists`, { managedPath });
			return false;
		}

		try {
			await this.app.vault.create(managedPath, "");
			loggerInfo(this, `Created ${type} file`, { mainPath, managedPath });
			return true;
		} catch (error) {
			loggerError(this, `Failed to create ${type} file`, {
				mainPath,
				managedPath,
				error,
			});
			return false;
		}
	}

	/**
	 * Delete all managed files for a main file
	 */
	async deleteManagedFiles(mainPath: string): Promise<void> {
		const managedFiles = this.getManagedFiles(mainPath);

		for (const relationship of managedFiles) {
			const file = this.app.vault.getAbstractFileByPath(
				relationship.managedFile,
			);
			if (file instanceof TFile) {
				try {
					await this.app.fileManager.trashFile(file);
					loggerInfo(this, `Deleted ${relationship.type} file`, {
						mainPath,
						managedPath: relationship.managedFile,
					});
				} catch (error) {
					loggerError(this, `Failed to delete ${relationship.type} file`, {
						managedPath: relationship.managedFile,
						error,
					});
				}
			}
		}
	}

	/**
	 * Get statistics about managed files
	 */
	getStatistics(): { [key in ManagedFileType]: number } & { total: number } {
		const stats = {
			sidecar: this.managedFilesByType.get("sidecar")?.size ?? 0,
			preview: this.managedFilesByType.get("preview")?.size ?? 0,
			redirect: this.managedFilesByType.get("redirect")?.size ?? 0,
			total: 0,
		};
		stats.total = stats.sidecar + stats.preview + stats.redirect;
		return stats;
	}

	/**
	 * Find orphaned managed files (where main file no longer exists)
	 */
	findOrphanedFiles(): { [key in ManagedFileType]: string[] } {
		const orphans: { [key in ManagedFileType]: string[] } = {
			sidecar: [],
			preview: [],
			redirect: [],
		};

		for (const [managedPath, relationship] of this.managedToMain) {
			const mainFile = this.app.vault.getAbstractFileByPath(
				relationship.mainFile,
			);
			if (!mainFile || !(mainFile instanceof TFile)) {
				orphans[relationship.type].push(managedPath);
			}
		}

		return orphans;
	}
}
