const path = require('path');
const { getAppContentRoot } = require('./paths');

/**
 * Single source of truth for SonarLink dependencies.
 * Add new entries here when features need more downloads.
 */
const DEPENDENCIES = [
  {
    id: 'ue4ss',
    version: '3.0.1',
    downloadUrl:
      'https://github.com/Subnautica2Modding/Subnautica2-UE4SS/releases/download/1.0.0/UE4SS_v3.0.1-953-gb872ad11.zip',
    installType: 'extract-zip-to-game-win64',
    verify: [
      { relativePath: 'dwmapi.dll', inGameWin64: true },
      { relativePath: 'ue4ss/UE4SS.dll', inGameWin64: true },
    ],
    requiresGameRestart: true,
  },
  {
    id: 'sonarlink-bridge',
    version: '1.9.28',
    installType: 'copy-bundled-mod',
    bundledRelativePath: path.join('bundled-mods', 'SonarLinkBridge'),
    gameRelativePath: path.join('ue4ss', 'Mods', 'SonarLinkBridge'),
    verify: [
      { relativePath: 'ue4ss/Mods/SonarLinkBridge/Scripts/main.lua', inGameWin64: true },
    ],
    requiresGameRestart: true,
    modsTxtName: 'SonarLinkBridge',
  },
];

const REQUIRED_UE4SS_MODS = [
  'CheatManagerEnablerMod',
  'ConsoleEnablerMod',
  'SonarLinkBridge',
];

function getBundledModPath(dep) {
  return path.join(getAppContentRoot(), dep.bundledRelativePath);
}

module.exports = {
  DEPENDENCIES,
  REQUIRED_UE4SS_MODS,
  getBundledModPath,
};
