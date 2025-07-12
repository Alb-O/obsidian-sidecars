import { loggerDebug, loggerInfo } from "@/utils";
import type SidecarPlugin from "@/main";

/**
 * Service responsible for registering and handling plugin commands
 * Separates command logic from the main plugin class
 */
export class CommandService {
	private plugin: SidecarPlugin;

	constructor(plugin: SidecarPlugin) {
		this.plugin = plugin;
		loggerDebug(this, "CommandService initialized");
	}

	/**
	 * Register all plugin commands
	 */
	registerCommands(): void {
		loggerDebug(this, "Registering all plugin commands");
		this.registerRevalidateCommand();
		// Add more commands here as needed
	}

	/**
	 * Register the revalidate sidecars command
	 */
	private registerRevalidateCommand(): void {
		loggerDebug(this, "Registering revalidate command");
		this.plugin.addCommand({
			id: "revalidate-sidecars",
			name: "Revalidate all sidecars",
			callback: async () => {
				loggerInfo(this, "Revalidate command triggered");
				await this.plugin.revalidateSidecars();
			},
		});
	}

	/**
	 * Register a command to create sidecar for current file
	 */
	registerCreateSidecarCommand(): void {
		loggerDebug(this, "Registering create sidecar command");
		this.plugin.addCommand({
			id: "create-sidecar-current-file",
			name: "Create sidecar for current file",
			callback: async () => {
				loggerInfo(this, "Create sidecar command triggered");
				const activeFile = this.plugin.app.workspace.getActiveFile();
				if (activeFile && !this.plugin.isSidecarFile(activeFile.path)) {
					await this.plugin.sidecarManager.createSidecarForFile(
						activeFile,
						true,
					);
				}
			},
		});
	}
}
