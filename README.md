# Sidecars Plugin for Obsidian

⚠️ NO LONGER MAINTAINED - If you're a plugin dev, would like to take over ownership, and need some sort of formal permission, contact me.

Automated management of 'sidecar' companion notes for attachments and other files.

## Getting started

After installing, open the plugin settings and configure which file types you'd like the plugin to monitor and manage. You can broadly add media file types (i.e. images, videos, or audio) or specific file types not natively supported by Obsidian by creating a list of extensions in the `Extra file types` setting.

## Features

- **Automatic and manual sidecar creation:**
  - Automatically create and manage sidecar files for any file type you choose.
  - Create sidecars on demand from the File Explorer context menu.
  - Pick a note from your vault to use as the default template for new sidecar files.

- **Context menu integration:**
  - Right-click any file to create or open its sidecar. If the file type is not monitored, you’ll be prompted to add it.

- **Orphan cleanup:**
  - Detects and prompts you to delete orphaned sidecar files (sidecars whose main file is missing or no longer monitored).

- **Explorer styling:**
  - Visually tag, color, and style sidecar files and their extensions in the File Explorer.
  - Optionally dim, hide, or add arrow indicators to sidecar files.

- **Folder scoping:**
  - Limit sidecar management to specific folders or exclude certain folders, with support for wildcards and regular expressions.

## Debugging

In Developer Console (`Ctrl+Shift+I`), run `window.DEBUG.enable('sidecars')`

To learn more, see [obsidian-logger](https://github.com/Alb-O/obsidian-logger).
