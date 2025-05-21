import type SidecarPlugin from './main';

export function updateSidecarFileAppearance(plugin: SidecarPlugin) {
  if (plugin.sidecarAppearanceObserver) {
    plugin.sidecarAppearanceObserver.disconnect();
    plugin.sidecarAppearanceObserver = undefined;
  }

  const processNavItem = (el: HTMLElement) => {
    const dataPath = el.getAttribute('data-path');
    if (!dataPath) return;

    const isSidecar = dataPath.endsWith(plugin.settings.sidecarSuffix);
    const existingTag = el.querySelector('.nav-file-tag.sidecar-tag');
    const innerContentEl = el.querySelector('.tree-item-inner');

    if (isSidecar) {
      // 1. Set draggable attribute based on settings
      if (plugin.settings.preventDraggingSidecars) {
        el.setAttribute('draggable', 'false');
      } else {
        el.removeAttribute('draggable');
      }

      // 2. Modify display name and add/update tag
      if (innerContentEl) {
        const sourceFilePath = dataPath.slice(0, -plugin.settings.sidecarSuffix.length);
        const sourceFileNameWithOriginalExt = sourceFilePath.substring(sourceFilePath.lastIndexOf('/') + 1);
        if (innerContentEl.textContent !== sourceFileNameWithOriginalExt) {
          innerContentEl.textContent = sourceFileNameWithOriginalExt;
        }
      }

      // Calculate expected tag text
      let tempTagText = plugin.settings.sidecarSuffix;
      if (tempTagText.endsWith('.md')) tempTagText = tempTagText.slice(0, -3);
      if (tempTagText.startsWith('.')) tempTagText = tempTagText.slice(1);
      const expectedTagText = tempTagText;

      if (existingTag) {
        if (existingTag.textContent !== expectedTagText) {
          existingTag.textContent = expectedTagText;
        }
        if (plugin.settings.dimSidecarsInExplorer) {
          existingTag.classList.add('dimmed');
        } else {
          existingTag.classList.remove('dimmed');
        }
      } else {
        const newTag = document.createElement('div');
        newTag.className = 'nav-file-tag sidecar-tag' + (plugin.settings.dimSidecarsInExplorer ? ' dimmed' : '');
        newTag.textContent = expectedTagText;
        el.appendChild(newTag);
      }
    } else {
      if (existingTag) existingTag.remove();
      if (el.getAttribute('draggable') === 'false') el.removeAttribute('draggable');
    }
  };

  plugin.sidecarAppearanceObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement && node.classList.contains('nav-file-title')) {
            processNavItem(node);
          }
        });
      }
    });
  });

  const navContainer = document.querySelector('.nav-files-container, .workspace-leaf-content .nav-files-container');
  if (navContainer) {
    plugin.sidecarAppearanceObserver.observe(navContainer, { childList: true, subtree: true });
  }

  document.querySelectorAll('.nav-file-title').forEach((el) => {
    if (el instanceof HTMLElement) processNavItem(el);
  });
}

export function updateSidecarHideCss(plugin: SidecarPlugin) {
  const id = 'sidecar-visibility-style';
  let styleElement = document.getElementById(id) as HTMLStyleElement | null;
  let styleTextContent = '';

  if (plugin.settings.hideSidecarsInExplorer) {
    styleTextContent += `
      .nav-file-title[data-path$='${plugin.settings.sidecarSuffix}'] {
        display: none !important;
      }
    `;
  } else if (plugin.settings.dimSidecarsInExplorer) {
    styleTextContent += `
      .nav-file-title[data-path$='${plugin.settings.sidecarSuffix}'] {
        color: var(--text-faint) !important;
      }
      .nav-file-title[data-path$='${plugin.settings.sidecarSuffix}']:hover,
      .nav-file-title[data-path$='${plugin.settings.sidecarSuffix}'].is-active {
        color: var(--text-muted) !important;
      }
    `;
  }

  if (plugin.settings.prependSidecarIndicator) {
    styleTextContent += `
      .nav-file-title[data-path$='${plugin.settings.sidecarSuffix}']::before {
        content: "⮡";
        padding-left: 0.2em;
        padding-right: 0.75em;
      }
      .nav-file-title[data-path$='${plugin.settings.sidecarSuffix}'] .tree-item-inner {
        vertical-align: text-top;
      }
      .nav-file-title[data-path$='${plugin.settings.sidecarSuffix}'] {
        padding-top: 0px !important;
        padding-bottom: calc(2 * var(--size-4-1)) !important;
      }
    `;
  }

  if (styleTextContent) {
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = id;
      document.head.appendChild(styleElement);
    }
    styleElement.textContent = styleTextContent;
  } else {
    if (styleElement) styleElement.remove();
  }
}
