import { Menu, MenuItem, MenuItemConstructorOptions, shell } from 'electron';
import { showGlobalSettings } from '../common';


const DEFAULT_MENU_TEMPLATE: MenuItemConstructorOptions[] = [
  ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
  { role: 'fileMenu' },
  { role: 'editMenu' },
  { role: 'viewMenu' },
  { role: 'windowMenu' },
  {
    role: 'help' as const,
    submenu: [
      {
        label: "About Paneron",
        click: async () => {
          await shell.openExternal('https://paneron.org');
        }
      },
    ],
  },
];


const DEFAULT_MENU = Menu.buildFromTemplate(DEFAULT_MENU_TEMPLATE);


const mainMenu = ((m: Menu) => {
  const appMenu = m.items.find(i => i.role?.toLowerCase() === 'appmenu')?.submenu;
  const fileMenu = m.items.find(i => i.role?.toLowerCase() === 'editmenu')?.submenu;
  const preferencesMenuItem = new MenuItem({
    label: "Preferences",
    click: () => showGlobalSettings.main!.trigger({}),
    accelerator: process.platform === 'darwin' ? 'Command+,' : undefined,
  });
  const sep = new MenuItem({
    type: 'separator',
  });
  if (appMenu) {
    // Typical on macOS
    appMenu.insert(1, sep);
    appMenu.insert(2, preferencesMenuItem);
  } else if (fileMenu) {
    // Typical on Non-macOS
    fileMenu.insert(0, preferencesMenuItem);
    fileMenu.insert(1, sep);
  } else {
    // ?
    m.insert(m.items.length, preferencesMenuItem);
  }
  return m;
})(DEFAULT_MENU);


export default mainMenu;
