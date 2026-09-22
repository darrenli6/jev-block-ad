import { defineConfig } from 'wxt';

export default defineConfig({
  extensionApi: 'chrome',
  manifest: {
    name: 'Jev Block Ad',
    version: '0.1.0',
    description: "AI ad blocker with no filter lists. TypeSafe AI's Jev model decides what is an ad. Bring your own key.",
    minimum_chrome_version: '121',
    permissions: ['storage', 'alarms', 'scripting'],
    host_permissions: ['https://api.typesafe.ai/*', '<all_urls>'],
    icons: {
      '16': 'icons/16.png',
      '32': 'icons/32.png',
      '48': 'icons/48.png',
      '128': 'icons/128.png',
    },
    action: {
      default_title: 'Jev Block Ad',
      default_icon: {
        '16': 'icons/toolbar-16.png',
        '32': 'icons/toolbar-32.png',
        '48': 'icons/toolbar-48.png',
        '128': 'icons/toolbar-128.png',
      },
    },
  },
  hooks: {
    'build:manifestGenerated'(_wxt, manifest) {
      if (manifest.options_ui) manifest.options_ui.open_in_tab = true;
    },
  },
});
