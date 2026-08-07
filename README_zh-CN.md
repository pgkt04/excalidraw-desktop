# excalidraw-desktop

<!-- hy-mt2-i18n:start -->
[English](./README.md) | **中文** | [日本語](./README_ja.md) | [Español](./README_es.md)
<!-- hy-mt2-i18n:end -->

适用于 Windows、macOS 和 Linux 系统的 Excalidraw 非官方桌面客户端。它实际上只是该网站的 Electron 封装版本，我创建它是因为不想在浏览器标签页中使用该网站。

> **注意：** 此版本会加载实时的 [excalidraw.com](https://excalidraw.com) 网站——首次启动时需要网络连接。由于浏览器的缓存功能，后续启动时可能无需联网即可使用。

![windows 客户端](./resources/windows.png)

## 安装
请前往 [Releases](https://github.com/pgkt04/excalidraw-desktop/releases/) 页面，下载适合您操作系统的安装程序：

| 平台 | 格式 |
|------|------|
| macOS | `.dmg`（Apple Silicon 芯片） |
| Windows | 安装版 `.exe` 或便携版 `.exe` |
| Linux | `.AppImage` 或 `.deb` |

### macOS
如果出现“文件已损坏且无法打开，建议将其移至废纸篓”的错误信息，请运行以下命令：
```bash
xattr -c /Applications/Excalidraw.app
```
出现此问题的原因是我没有开发者证书，且该文件也未经过公证。

### Linux（AppImage）
下载完成后，需将 AppImage 文件设置为可执行文件：
```bash
chmod +x Excalidraw-*.AppImage
./Excalidraw-*.AppImage
```

## 文件关联
该应用会将自身注册为 `.excalidraw` 文件的处理程序。您可以双击任何 `.excalidraw` 文件，直接在应用中打开它。在 Windows 系统（使用 NSIS 安装程序）上，安装时会提示您进行设置；而在 macOS 和 Linux 系统上则无需额外操作。

## 开发
在构建项目之前，请确保已安装以下前置条件：

- Node.js（版本 22.12.0 或更高）
- npm（随 Node.js 一同提供）

克隆仓库：
```bash
git clone https://github.com/pgkt04/excalidraw-desktop.git
cd excalidraw-desktop
```

安装依赖项：
```bash
npm install
```

### 运行
以开发模式运行应用：
```bash
npm start
```

### 构建
生成正式版本的安装包：

| 命令 | 平台 | 输出结果 |
|------|------|----------|
| `npm run dist` | 当前操作系统 | 视平台而定 |
| `npm run dist:mac` | macOS | `.dmg`（arm64 架构） |
| `npm run dist:win` | Windows | 便携版 `.exe` + NSIS 安装版 `.exe` |
| `npm run dist:linux` | Linux | `.AppImage` + `.deb` |

生成的安装程序将会存放在 `dist/` 文件夹中。
