// Main plugin export
export { default as SidecarPlugin } from "./main";
export { default } from "./main";

// Export types for external use
export type { SidecarPluginSettings, SidecarPluginInterface } from "@/types";
export { DEFAULT_SETTINGS } from "@/types";

// Export services for potential external use
export type { FilePathService, CommandService, MenuService } from "@/services";

// Export modals for external use
export * from "@/modals";
