import { TFile, Notice, App } from 'obsidian';
import { loggerDebug, loggerInfo, loggerWarn, loggerError } from '@/utils';
import type SidecarPlugin from '@/main';

/**
 * File type for derivative file operations
 */
export type DerivativeFileType = 'sidecar' | 'redirect' | 'preview';

/**
 * Interface for path extraction methods
 */
export interface PathExtractor {
	getSourceFromDerivative: (derivativePath: string) => string | null;
	getDerivativeFromSource: (sourcePath: string, extension?: string) => string;
}

/**
 * Configuration for rename operations
 */
export interface RenameOperationConfig {
	fileType: DerivativeFileType;
	pathExtractor: PathExtractor;
	showUserNotices: boolean;
	logContext: string;
}

/**
 * Service for centralized file operations to reduce code duplication
 */
export class FileOperationService {
	private plugin: SidecarPlugin;
	private app: App;
	private nonExistentFiles = new Set<string>();
	private readonly NON_EXISTENT_CACHE_SIZE = 50;
	private recentOperations = new Map<string, number>();
	private readonly OPERATION_CACHE_MS = 1000; // 1 second

	constructor(plugin: SidecarPlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
	}

	/**
	 * Check if we've recently performed this exact operation to avoid redundant work
	 */
	private hasRecentOperation(operationKey: string): boolean {
		const now = Date.now();
		const lastOperation = this.recentOperations.get(operationKey);
		
		if (lastOperation && (now - lastOperation) < this.OPERATION_CACHE_MS) {
			return true;
		}
		
		// Clean up old operations
		if (this.recentOperations.size > 100) {
			const cutoff = now - this.OPERATION_CACHE_MS;
			for (const [key, timestamp] of this.recentOperations.entries()) {
				if (timestamp < cutoff) {
					this.recentOperations.delete(key);
				}
			}
		}
		
		return false;
	}

	/**
	 * Mark an operation as recently completed
	 */
	private markOperationCompleted(operationKey: string): void {
		this.recentOperations.set(operationKey, Date.now());
	}

	/**
	 * Generic method to rename main file when derivative file is renamed
	 */
	async renameMainFileForDerivative(
		oldDerivativePath: string,
		newDerivativePath: string,
		config: RenameOperationConfig
	): Promise<void> {
		loggerDebug(this, `Processing ${config.fileType} rename - determining main file paths`, { 
			oldPath: oldDerivativePath, 
			newPath: newDerivativePath,
			context: config.logContext
		});

		const oldMainPath = config.pathExtractor.getSourceFromDerivative(oldDerivativePath);
		if (!oldMainPath) {
			loggerWarn(this, `Cannot determine old main file path for ${config.fileType}`, { 
				derivativePath: oldDerivativePath,
				reason: `invalid ${config.fileType} path format`
			});
			return;
		}

		const newMainPath = config.pathExtractor.getSourceFromDerivative(newDerivativePath);
		if (!newMainPath) {
			loggerWarn(this, `Cannot determine new main file path for ${config.fileType}`, { 
				derivativePath: newDerivativePath,
				reason: `invalid ${config.fileType} path format`
			});
			return;
		}		// Early exit if main file doesn't exist - reduce log noise for expected cases
		// Check cache first to avoid repeated file system checks
		if (this.nonExistentFiles.has(oldMainPath)) {
			// File was recently confirmed as non-existent - skip silently
			return;
		}
		
		const mainFile = this.app.vault.getAbstractFileByPath(oldMainPath);
		if (!mainFile || !(mainFile instanceof TFile)) {
			// Add to cache and manage cache size
			this.nonExistentFiles.add(oldMainPath);
			if (this.nonExistentFiles.size > this.NON_EXISTENT_CACHE_SIZE) {
				const firstItem = this.nonExistentFiles.values().next().value;
				this.nonExistentFiles.delete(firstItem);
			}
			
			// Only log as debug since this is often expected (derivative files can exist without main files)
			loggerDebug(this, `Main file not found - skipping ${config.fileType} rename operation`, { 
				oldMainPath,
				newMainPath,
				context: config.logContext,
				cached: false
			});
			return;
		}
		
		// Remove from non-existent cache if file now exists
		this.nonExistentFiles.delete(oldMainPath);

		loggerDebug(this, 'Old main file path determined', { oldMainPath });
		loggerDebug(this, 'New main file path determined', { newMainPath });
		loggerDebug(this, 'Main file located successfully', { filePath: mainFile.path });

		const existingTargetFile = this.app.vault.getAbstractFileByPath(newMainPath);
		if (existingTargetFile) {
			loggerWarn(this, 'Target main file path already exists - cannot rename', { 
				newMainPath,
				fileName: newMainPath.split('/').pop()
			});
			if (config.showUserNotices) {
				new Notice(`Cannot rename main file: ${newMainPath.split('/').pop()} already exists`, 3000);
			}
			return;
		}
		loggerDebug(this, 'Target path is available - proceeding with main file rename');

		try {
			loggerDebug(this, `Renaming main file to match ${config.fileType} rename`, { 
				from: oldMainPath, 
				to: newMainPath 
			});
			await this.app.fileManager.renameFile(mainFile, newMainPath);
			
			loggerInfo(this, `Main file successfully renamed to match ${config.fileType}`, { 
				oldPath: oldMainPath,
				newPath: newMainPath,
				fileName: newMainPath.split('/').pop()
			});

			if (config.showUserNotices) {
				new Notice(`Also renamed main file to: ${newMainPath.split('/').pop()}`, 2000);
			}
		} catch (error) {
			loggerError(this, `Failed to rename main file for ${config.fileType}`, { 
				oldPath: oldMainPath,
				newPath: newMainPath,
				error: error instanceof Error ? error.message : String(error)
			});

			if (config.showUserNotices) {
				new Notice(`Failed to rename main file: ${error instanceof Error ? error.message : String(error)}`, 3000);
			}
		}
	}

	/**
	 * Generic method to rename derivative files when main file is renamed
	 */
    async renameDerivativeForMainFile(
		oldMainPath: string,
		newMainPath: string,
		config: RenameOperationConfig,
		extensions?: string[]
	): Promise<void> {
		// Create operation key to check for recent operations
		const operationKey = `${config.fileType}:${oldMainPath}→${newMainPath}`;
		
		if (this.hasRecentOperation(operationKey)) {
			loggerDebug(this, `Skipping recent ${config.fileType} operation`, { 
				oldMainPath, 
				newMainPath,
				context: config.logContext
			});
			return;
		}
		
		loggerDebug(this, `Checking for ${config.fileType} files to rename`, { 
			oldMainPath, 
			newMainPath,
			context: config.logContext
		});

		// Handle single derivative file (sidecar, redirect)
		if (!extensions) {
			const oldDerivativePath = config.pathExtractor.getDerivativeFromSource(oldMainPath);
			const wasProcessed = await this.renameSingleDerivativeFile(
				oldDerivativePath,
				newMainPath,
				config
			);
			
			// Mark operation as completed if we actually did something
			if (wasProcessed) {
				this.markOperationCompleted(operationKey);
			}
			return;
		}		// Handle multiple derivative files (preview files with different extensions)
		let filesFound = false;
		for (const ext of extensions) {
			const oldDerivativePath = config.pathExtractor.getDerivativeFromSource(oldMainPath, ext);
			
			loggerDebug(this, `Checking ${config.fileType} file with extension`, {
				oldMainPath,
				extension: ext,
				expectedPath: oldDerivativePath,
				context: config.logContext
			});
			
			const wasRenamed = await this.renameSingleDerivativeFile(
				oldDerivativePath,
				newMainPath,
				config,
				ext
			);
			if (wasRenamed) {
				filesFound = true;
			}
		}
		// If no files found, perform orphaned file search for preview files
		if (!filesFound && config.fileType === 'preview') {
			loggerDebug(this, 'No standard preview files found - searching for orphaned preview files', {
				oldMainPath,
				newMainPath,
				context: config.logContext
			});
			const foundOrphaned = await this.findAndRenameOrphanedPreviewFiles(oldMainPath, newMainPath);
			filesFound = foundOrphaned;
		}

		// Mark operation as completed if we found and processed files
		if (filesFound) {
			this.markOperationCompleted(operationKey);
		}

		if (!filesFound) {
			loggerDebug(this, `No ${config.fileType} files found to rename`, { oldMainPath });
		}
	}

	/**
	 * Rename a single derivative file
	 */
    private async renameSingleDerivativeFile(
		oldDerivativePath: string,
		newMainPath: string,
		config: RenameOperationConfig,
		extension?: string
	): Promise<boolean> {
		const newDerivativePath = config.pathExtractor.getDerivativeFromSource(newMainPath, extension);
		// Early exit if source and target paths are the same
		if (oldDerivativePath === newDerivativePath) {
			loggerDebug(this, `${config.fileType} file paths are identical - no rename needed`, { 
				path: oldDerivativePath,
				extension,
				context: config.logContext
			});
			return true;
		}

		loggerDebug(this, `Path comparison for ${config.fileType}`, {
			oldPath: oldDerivativePath,
			newPath: newDerivativePath,
			areEqual: oldDerivativePath === newDerivativePath,
			extension,
			context: config.logContext
		});
		const derivativeFile = this.app.vault.getAbstractFileByPath(oldDerivativePath);

		// Check if file is already at the target location (for all file types)
		let fileToRename = derivativeFile;
		
		if (!fileToRename) {
			// File not found at old location - check if it's already at the new location
			const fileAtNewLocation = this.app.vault.getAbstractFileByPath(newDerivativePath);
			if (fileAtNewLocation) {
				loggerDebug(this, `${config.fileType} file already at target location - no rename needed`, { 
					targetPath: newDerivativePath,
					oldPath: oldDerivativePath,
					extension 
				});
				return true;
			}
			
			// For preview files, also search for orphaned files
			if (config.fileType === 'preview') {
				// This will be handled by the orphaned file search later
				return false;
			}
			
			loggerDebug(this, `${config.fileType} file not found at expected location`, { 
				expectedPath: oldDerivativePath,
				extension 
			});
			return false;
		}

		if (fileToRename && fileToRename instanceof TFile) {
			// Check if target path already exists and is different from source
			const existingFile = this.app.vault.getAbstractFileByPath(newDerivativePath);
			if (existingFile && existingFile !== fileToRename) {
				loggerWarn(this, `Target ${config.fileType} path already exists - skipping rename`, { 
					newPath: newDerivativePath,
					extension
				});
				return false;
			}

			// Skip if source and target paths are the same
			if (fileToRename.path === newDerivativePath) {
				loggerDebug(this, `${config.fileType} file already has correct name - no rename needed`, { 
					path: newDerivativePath,
					extension 
				});
				return true;
			}

            try {
				loggerDebug(this, `Renaming ${config.fileType} file`, { 
					from: fileToRename.path, 
					to: newDerivativePath,
					extension,
					pathsEqual: fileToRename.path === newDerivativePath
				});
				
				// Double-check that paths are actually different
				if (fileToRename.path === newDerivativePath) {
					loggerWarn(this, `Attempted to rename file to same path - this should have been caught earlier`, {
						path: newDerivativePath,
						fileType: config.fileType
					});
					return true;
				}
				
				await this.app.fileManager.renameFile(fileToRename, newDerivativePath);

				loggerInfo(this, `${config.fileType} file renamed successfully`, { 
					oldPath: fileToRename.path,
					newPath: newDerivativePath,
					mainFile: newMainPath
				});
				return true;
			} catch (error) {
				loggerError(this, `Failed to rename ${config.fileType} file`, { 
					oldPath: fileToRename.path,
					newPath: newDerivativePath,
					extension,
					error: error instanceof Error ? error.message : String(error)
				});
				return false;
			}
		}

		return false;
	}

	/**
	 * Find and rename orphaned preview files (specific to preview files)
	 */
	private async findAndRenameOrphanedPreviewFiles(oldMainPath: string, newMainPath: string): Promise<boolean> {
		const allFiles = this.app.vault.getFiles();
		const oldBaseName = oldMainPath.replace(/\.[^.]+$/, '');
		const newBaseName = newMainPath.replace(/\.[^.]+$/, '');
		let foundFiles = false;
		
		for (const file of allFiles) {
			if (this.plugin.isPreviewFile(file.path)) {
				const sourceMainPath = this.plugin.getSourcePathFromPreview(file.path);
				
				if (sourceMainPath === oldMainPath) {
					const newPreviewPath = file.path.replace(oldBaseName, newBaseName);
					
					if (file.path === newPreviewPath) {
						continue;
					}
					
					const existingFile = this.app.vault.getAbstractFileByPath(newPreviewPath);
					if (existingFile && existingFile !== file) {
						loggerWarn(this, 'Target preview path already exists - skipping orphan rename', { 
							from: file.path,
							to: newPreviewPath
						});
						continue;
					}

                    try {
						loggerDebug(this, 'Renaming orphaned preview file', { 
							from: file.path, 
							to: newPreviewPath
						});
						await this.app.fileManager.renameFile(file, newPreviewPath);
						
						loggerInfo(this, 'Orphaned preview file renamed successfully', { 
							oldPath: file.path,
							newPath: newPreviewPath,
							mainFile: newMainPath
						});
						foundFiles = true;
					} catch (error) {
						loggerError(this, 'Failed to rename orphaned preview file', { 
							oldPath: file.path,
							newPath: newPreviewPath,
							error: error instanceof Error ? error.message : String(error)
						});
					}
				}
			}
		}
		return foundFiles;
	}

	/**
	 * Create path extractors for different file types
	 */
	createPathExtractors() {
		return {
			sidecar: {
				getSourceFromDerivative: (path: string) => this.plugin.getSourcePathFromSidecar(path),
				getDerivativeFromSource: (path: string) => this.plugin.getSidecarPath(path)
			} as PathExtractor,

			redirect: {
				getSourceFromDerivative: (path: string) => this.plugin.getSourcePathFromRedirect(path),
				getDerivativeFromSource: (path: string) => this.plugin.getRedirectPath(path)
			} as PathExtractor,

			preview: {
				getSourceFromDerivative: (path: string) => this.plugin.getSourcePathFromPreview(path),
				getDerivativeFromSource: (path: string, ext: string = 'png') => this.plugin.getPreviewPath(path, ext)
			} as PathExtractor
		};
	}
}
