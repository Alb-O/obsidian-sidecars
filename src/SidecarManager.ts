import type SidecarPlugin from "@/main";
import { TFile, Notice } from "obsidian";
import { loggerDebug, loggerInfo, loggerWarn, loggerError } from "@/utils";

export class SidecarManager {
	private plugin: SidecarPlugin;

	constructor(plugin: SidecarPlugin) {
		this.plugin = plugin;
	}
	/**
	 * Create a sidecar file for a given file if it doesn't exist and auto-creation is enabled
	 */
	async createSidecarForFile(file: TFile, forceCreate = false): Promise<void> {
		const filePath = file.path;

		loggerDebug(this, "Checking if sidecar creation is needed", {
			filePath,
			forceCreate,
		});

		// Skip if this is already a derivative file (sidecar, redirect, preview)
		if (this.plugin.filePathService.isDerivativeFile(filePath)) {
			loggerDebug(
				this,
				"File is a derivative file - skipping sidecar creation",
				{ filePath },
			);
			return;
		}

		// Skip if file is not monitored (unless forced)
		if (!forceCreate && !this.plugin.isMonitoredFile(filePath)) {
			loggerDebug(this, "File is not monitored - skipping sidecar creation", {
				filePath,
			});
			return;
		}

		// Skip if auto-creation is disabled (unless forced)
		if (!forceCreate && !this.plugin.settings.autoCreateSidecars) {
			loggerDebug(this, "Auto-creation disabled - skipping sidecar creation");
			return;
		}

		const sidecarPath = this.plugin.getSidecarPath(filePath);

		// Check if sidecar already exists
		const existingSidecar =
			this.plugin.app.vault.getAbstractFileByPath(sidecarPath);
		if (existingSidecar) {
			loggerDebug(this, "Sidecar already exists - skipping creation", {
				sidecarPath,
			});
			return;
		}

		try {
			loggerDebug(this, "Creating new sidecar file", { filePath, sidecarPath });

			let sidecarContent = "";
			const templatePath = this.plugin.settings.templateNotePath;
			if (templatePath) {
				const templateFile =
					this.plugin.app.vault.getAbstractFileByPath(templatePath);
				if (templateFile && templateFile instanceof TFile) {
					try {
						sidecarContent = await this.plugin.app.vault.read(templateFile);
					} catch (err) {
						loggerWarn(this, "Failed to read template note for sidecar", {
							templatePath,
							error: err,
						});
					}
				}
			}
			await this.plugin.app.vault.create(sidecarPath, sidecarContent);

			loggerInfo(this, "Sidecar file created successfully", {
				mainFile: filePath,
				sidecarFile: sidecarPath,
			});
		} catch (error) {
			loggerError(this, "Failed to create sidecar file", {
				filePath,
				sidecarPath,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Delete the sidecar file when the main file is deleted
	 */
	async deleteSidecarForFile(file: TFile): Promise<void> {
		const filePath = file.path;

		loggerDebug(this, "Checking if sidecar deletion is needed", { filePath });

		// Skip if this is a derivative file itself
		if (this.plugin.filePathService.isDerivativeFile(filePath)) {
			loggerDebug(this, "File is a derivative file - no cleanup needed", {
				filePath,
			});
			return;
		}

		// Skip if file was not monitored
		if (!this.plugin.isMonitoredFile(filePath)) {
			loggerDebug(this, "File was not monitored - no sidecar to delete", {
				filePath,
			});
			return;
		}

		const sidecarPath = this.plugin.getSidecarPath(filePath);
		const sidecarFile =
			this.plugin.app.vault.getAbstractFileByPath(sidecarPath);

		if (!sidecarFile || !(sidecarFile instanceof TFile)) {
			loggerDebug(this, "No sidecar file found to delete", { sidecarPath });
			return;
		}

		try {
			loggerDebug(this, "Deleting sidecar file", { filePath, sidecarPath });
			await this.plugin.app.fileManager.trashFile(sidecarFile);

			loggerInfo(this, "Sidecar file deleted successfully", {
				mainFile: filePath,
				sidecarFile: sidecarPath,
			});
		} catch (error) {
			loggerError(this, "Failed to delete sidecar file", {
				filePath,
				sidecarPath,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	/**
	 * Handle renaming of sidecar files when main file is renamed
	 */
	async handleSidecarRename(oldPath: string, newPath: string): Promise<void> {
		loggerDebug(
			this,
			"Processing main file rename - checking for sidecar and preview files",
			{ oldPath, newPath },
		);

		// Skip sidecar management if file is not monitored, but still handle preview files
		if (!this.plugin.isMonitoredFile(newPath)) {
			loggerDebug(
				this,
				"New path is not monitored - skipping sidecar, handling preview rename only",
				{ newPath },
			);
			await this.handlePreviewRename(oldPath, newPath);
			return;
		}

		// Use FileOperationService for sidecar rename
		const pathExtractors =
			this.plugin.fileOperationService.createPathExtractors();

		try {
			await this.plugin.fileOperationService.renameDerivativeForMainFile(
				oldPath,
				newPath,
				{
					fileType: "sidecar",
					pathExtractor: pathExtractors.sidecar,
					showUserNotices: false,
					logContext: "main-sidecar-rename",
				},
			);
		} catch (error) {
			loggerError(
				this,
				"Failed to rename sidecar file using FileOperationService",
				{
					oldPath,
					newPath,
					error: error instanceof Error ? error.message : String(error),
				},
			);
		}
		// Also handle preview files
		await this.handlePreviewRename(oldPath, newPath);
	}

	/**
	 * Handle renaming of preview files when main file is renamed
	 */
	public async handlePreviewRename(
		oldMainPath: string,
		newMainPath: string,
	): Promise<void> {
		const pathExtractors =
			this.plugin.fileOperationService.createPathExtractors();
		const commonPreviewExts = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

		await this.plugin.fileOperationService.renameDerivativeForMainFile(
			oldMainPath,
			newMainPath,
			{
				fileType: "preview",
				pathExtractor: pathExtractors.preview,
				showUserNotices: false,
				logContext: "main-preview-rename",
			},
			commonPreviewExts,
		);
	}

	/**
	 * Handle renaming of redirect files when main file is renamed
	 */
	public async handleRedirectRename(
		oldMainPath: string,
		newMainPath: string,
	): Promise<void> {
		const pathExtractors =
			this.plugin.fileOperationService.createPathExtractors();

		await this.plugin.fileOperationService.renameDerivativeForMainFile(
			oldMainPath,
			newMainPath,
			{
				fileType: "redirect",
				pathExtractor: pathExtractors.redirect,
				showUserNotices: false,
				logContext: "main-redirect-rename",
			},
		);
	}

	/**
	 * Revalidate all sidecars in the vault
	 */
	async revalidateAllSidecars(): Promise<void> {
		loggerDebug(this, "Starting comprehensive sidecar revalidation");

		const { orphanSidecars, orphanReasons, createdCount } =
			await this.scanAndValidateFiles();

		if (orphanSidecars.length > 0) {
			loggerInfo(this, "Found orphaned sidecars - showing deletion modal", {
				orphanCount: orphanSidecars.length,
			});

			await this.plugin.showOrphanModal(
				orphanSidecars,
				orphanReasons,
				(deletedCount: number) => {
					const totalMessage = `Revalidation complete. Created: ${createdCount}, Deleted: ${deletedCount}`;
					new Notice(totalMessage, 4000);
					loggerInfo(this, "Revalidation completed", {
						created: createdCount,
						deleted: deletedCount,
					});
				},
			);
		} else {
			const message =
				createdCount > 0
					? `Revalidation complete. Created ${createdCount} sidecar${createdCount !== 1 ? "s" : ""}.`
					: "Revalidation complete. No changes needed.";

			new Notice(message, 3000);
			loggerInfo(this, "Revalidation completed", {
				created: createdCount,
				deleted: 0,
				orphansFound: false,
			});
		}

		// Update appearance after revalidation
		this.plugin.updateSidecarFileAppearance();
	}

	/**
	 * Scan all files and validate sidecars
	 */
	private async scanAndValidateFiles(): Promise<{
		validFiles: string[];
		orphanSidecars: string[];
		orphanReasons: Record<string, string>;
		createdCount: number;
	}> {
		const validFiles: string[] = [];
		const orphanSidecars: string[] = [];
		const orphanReasons: Record<string, string> = {};
		let createdCount = 0;

		const allFiles = this.plugin.app.vault.getFiles();
		loggerDebug(this, "Scanning all files for validation", {
			totalFiles: allFiles.length,
		});

		// Process main files
		for (const file of allFiles) {
			const filePath = file.path;

			// Skip derivative files
			if (this.plugin.filePathService.isDerivativeFile(filePath)) {
				continue;
			}

			// Check if file should be monitored
			if (this.plugin.isMonitoredFile(filePath)) {
				validFiles.push(filePath);

				// Auto-create sidecar if enabled and doesn't exist
				if (this.plugin.settings.autoCreateSidecars) {
					const sidecarPath = this.plugin.getSidecarPath(filePath);
					const existingSidecar =
						this.plugin.app.vault.getAbstractFileByPath(sidecarPath);

					if (!existingSidecar) {
						try {
							let sidecarContent = "";
							const templatePath = this.plugin.settings.templateNotePath;
							if (templatePath) {
								const templateFile =
									this.plugin.app.vault.getAbstractFileByPath(templatePath);
								if (templateFile && templateFile instanceof TFile) {
									try {
										sidecarContent =
											await this.plugin.app.vault.read(templateFile);
									} catch (err) {
										loggerWarn(
											this,
											"Failed to read template note for sidecar",
											{
												templatePath,
												error: err,
											},
										);
									}
								}
							}
							if (!sidecarContent) {
								sidecarContent = `# ${file.basename}\n\nSidecar notes for ${file.name}\n`;
							}
							await this.plugin.app.vault.create(sidecarPath, sidecarContent);
							createdCount++;

							loggerDebug(this, "Created missing sidecar during revalidation", {
								mainFile: filePath,
								sidecarFile: sidecarPath,
							});
						} catch (error) {
							loggerError(
								this,
								"Failed to create sidecar during revalidation",
								{
									filePath,
									sidecarPath,
									error: error instanceof Error ? error.message : String(error),
								},
							);
						}
					}
				}
			}
		}

		// Find orphaned sidecars
		for (const file of allFiles) {
			const filePath = file.path;

			if (this.plugin.isSidecarFile(filePath)) {
				const mainPath = this.plugin.getSourcePathFromSidecar(filePath);

				if (!mainPath) {
					orphanSidecars.push(filePath);
					orphanReasons[filePath] = "Invalid sidecar format";
					continue;
				}

				const mainFile = this.plugin.app.vault.getAbstractFileByPath(mainPath);
				if (!mainFile) {
					orphanSidecars.push(filePath);
					orphanReasons[filePath] = `Main file not found: ${mainPath}`;
					continue;
				}

				if (!this.plugin.isMonitoredFile(mainPath)) {
					orphanSidecars.push(filePath);
					orphanReasons[filePath] =
						`Main file no longer monitored: ${mainPath}`;
				}
			}
		}

		loggerInfo(this, "File scan completed", {
			validFiles: validFiles.length,
			orphanSidecars: orphanSidecars.length,
			created: createdCount,
		});

		return { validFiles, orphanSidecars, orphanReasons, createdCount };
	}
}
