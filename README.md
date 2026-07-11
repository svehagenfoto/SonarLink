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

## First launch

1. Close Subnautica 2 if it is already open
2. Start `SonarLink.exe` as administrator. Always run SonarLink as administrator. If you do not, the program may not work properly
3. Choose a folder when asked. This is where SonarLink keeps its files
4. Click Yes when asked to download required components
5. Wait until the install finishes
6. SonarLink will prompt you to launch Subnautica 2
7. Start Subnautica 2 from Steam
8. Make sure Subnautica 2 is in windowed fullscreen, not fullscreen
9. SonarLink opens the mod menu when the game is running

Press **Home** to open and close the menu while playing.

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

## SonarLink Credits

**Disclaimer:** Not affiliated with Unknown Worlds Entertainment. Subnautica 2 is a trademark of Unknown Worlds Entertainment.

### Creator and support

**StypX2K**, creator and developer of SonarLink.

Join the [Discord server](https://discord.gg/S2JQyBvwyB) for updates, feedback, and bug reports. Please report bugs in the [support channel](https://discordapp.com/channels/1524781503161307336/1525247960126980146). Nexus endorsements also help a lot while SonarLink is still growing.

- [Nexus page](https://www.nexusmods.com/subnautica2/mods/434)

### Credits and dependencies

- [UE4SS](https://www.nexusmods.com/subnautica2/mods/36) by the UE4SS team
- SonarLinkBridge by StypX2K
- CheatManagerEnablerMod (installed automatically, bundled with UE4SS)
- ConsoleEnablerMod (installed automatically, bundled with UE4SS)

### License

SonarLink is proprietary software. See [LICENSE](LICENSE) for full terms.

Copyright (c) 2026 StypX2K (Hermann Svehagen). All rights reserved.

Only StypX2K may use, modify, or distribute SonarLink by default. Any other use
requires prior written permission. This includes SonarLink design, source code,
and functionality.
