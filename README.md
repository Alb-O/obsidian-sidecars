# Sidecars Plugin for Obsidian

Automated, user-friendly management of 'sidecar' companion notes for non-markdown files.

## Getting started

After installing, open the plugin settings and configure which file types you'd like the plugin to monitor and manage. You can broadly add media file types (i.e. images, videos, or audio) or specific file types not natively supported by Obsidian by creating a list of extensions in the `Extra file types` setting.

## Features

- **Automatic and manual sidecar creation:**
  - Automatically create and manage sidecar files for any file type you choose.
  - Create sidecars on demand from the File Explorer context menu.

- **Context menu integration:**
  - Right-click any file to create or open its sidecar. If the file type is not monitored, you’ll be prompted to add it.

- **Orphan cleanup:**
  - Detects and prompts you to delete orphaned sidecar files (sidecars whose main file is missing or no longer monitored).

- **Explorer styling:**
  - Visually tag, color, and style sidecar files and their extensions in the File Explorer.
  - Optionally dim, hide, or add arrow indicators to sidecar files.

- **Folder scoping:**
  - Limit sidecar management to specific folders or exclude certain folders, with support for wildcards and regular expressions.

- **Advanced:**
  - Integration with my (WIP) Blender plugin '[Blend Vault](https://github.com/AMC-Albert/blend_vault_ext)' to automatically manage linked relationships between Blend files.