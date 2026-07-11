# SonarLink

SonarLink is a mod companion for **Subnautica 2**. It runs alongside the game, installs the required bridge mod automatically, and opens an in game style menu for mod features.

## Current features

**Third person camera**: Toggle third person view, set a custom keybind, and adjust camera distance with a slider.

**Auto vehicle camera adjust**: When you enter or leave a vehicle, the third person camera distance adjusts automatically for a better view.

**In game menu**: Press **Home** to open and close the SonarLink menu while playing.

**Auto close**: SonarLink closes when Subnautica 2 closes.

## Planned features

**Growing minimap**: A live 2D view of the world that reveals and expands as you swim and explore.

**Full map view**: Open a larger map to see everything you have already discovered and the areas you have swum through.

**Custom map markers**: Place named markers on the full map. SonarLink remembers them and shows them on both the full map and the minimap.

## Requirements

- Windows
- Subnautica 2 (Steam)
- Node.js (for development only)

On first start, SonarLink asks you to choose a data folder (for example `C:\SonarLink`). Config, logs, and game bridge files are stored there.

SonarLink installs UE4SS and the SonarLink bridge mod into the game folder. On some PCs you may need to **run SonarLink as administrator** for the install to succeed.

## Development setup

```bash
git clone https://github.com/svehagenfoto/SonarLink.git
cd SonarLink
npm install
```

Start the app:

- Double click `Start SonarLink.bat`, or
- Run `npm run restart` from the project folder

Build a portable exe:

```bash
npm run build
```

Output: `SonarLink-{version}.exe` in the project root.

## Project structure

| Area | Path |
|------|------|
| Main process | `src/main/` |
| Menu UI | `src/renderer/shell/` |
| Startup UI | `src/renderer/startup/` |
| Shared UI components | `src/renderer/shared/` |
| Game bridge mod | `bundled-mods/SonarLinkBridge/` |

## Copyright

© Hermann Svehagen. All rights reserved.

This is a private repository. The code may not be copied, modified, or distributed without permission.
