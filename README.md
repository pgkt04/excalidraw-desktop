# spotify-desktop
Unofficial desktop client for Spotify on Windows, macOS, and Linux. It is just an electron wrapper for the website, I made this because I don't want to use it in a tab.

Name of App is actually "Electronfy", in order to avoid any problem during installation on business computer.

> **Note:** This loads the live [spotify.com](https://open.spotify.com) website — an internet connection is needed for the first launch. Subsequent launches may work offline thanks to browser caching.

## Installation
Head over to the [Releases](https://github.com/pprol/spotify-desktop/releases/) page and download the appropriate installer for your operating system:

| Platform | Format |
|----------|--------|
| macOS | `.dmg` (Apple Silicon) |
| Windows | Setup `.exe` or Portable `.exe` |
| Linux | `.AppImage` or `.deb` |

### macOS
If you get the error "Is Damaged and Can't Be Opened. You Should Move It To The Bin", run:
```bash
xattr -c /Applications/Electronfy.app
```
This is because I don't have a developer certificate and it's not notarized.

### Linux (AppImage)
After downloading, make the AppImage executable:
```bash
chmod +x Electronfy-*.AppImage
./Electronfy-*.AppImage
```

## Development
Before building the project, ensure you have the following prerequisites installed:

- Node.js (version 22.12.0 or higher)
- npm (comes with Node.js)

Clone the repository:
```bash
git clone https://github.com/pprol/spotify-desktop.git
cd spotify-desktop
```

Install the dependencies:
```bash
npm install
```

### Running
To run the app in development mode:
```bash
npm start
```

### Building
To create a production build:

| Command | Platform | Output |
|---------|----------|--------|
| `npm run dist` | Current OS | Depends on platform |
| `npm run dist:mac` | macOS | `.dmg` (arm64) |
| `npm run dist:win` | Windows | Portable `.exe` + NSIS Setup `.exe` |
| `npm run dist:linux` | Linux | `.AppImage` + `.deb` |

The generated installers will be in the `dist/` folder.
