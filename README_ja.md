# excalidraw-desktop

<!-- hy-mt2-i18n:start -->
[English](./README.md) | [中文](./README_zh-CN.md) | **日本語** | [Español](./README_es.md)
<!-- hy-mt2-i18n:end -->

Windows、macOS、Linux向けのExcalidraw用非公式デスクトップクライアントです。これは単にウェブサイトをElectronでラップしたもので、タブで利用したくないという思いから自作しました。

> **注意:** このアプリはリアルタイムの[excalidraw.com](https://excalidraw.com)ウェブサイトを読み込むため、初回起動時にはインターネット接続が必要です。ブラウザのキャッシュ機能により、その後の起動ではオフラインでも動作する場合があります。

![windows client](./resources/windows.png)

## インストール
[Releases](https://github.com/pgkt04/excalidraw-desktop/releases/)ページにアクセスし、ご使用のオペレーティングシステムに合ったインストーラーをダウンロードしてください：

| プラットフォーム | 形式 |
|----------|--------|
| macOS | `.dmg` (Apple Silicon) |
| Windows | Setup `.exe` または Portable `.exe` |
| Linux | `.AppImage` または `.deb` |

### macOS
「破損しており開けられません。ゴミ箱に移動することをお勧めします」というエラーが表示された場合は、次のコマンドを実行してください：
```bash
xattr -c /Applications/Excalidraw.app
```
これは、開発者証明書を持っておらず、公証も行っていないためです。

### Linux (AppImage)
ダウンロード後、AppImageを実行可能にします：
```bash
chmod +x Excalidraw-*.AppImage
./Excalidraw-*.AppImage
```

## ファイルの関連付け
このアプリは`.excalidraw`ファイルの処理エンジンとして自動的に登録されます。任意の`.excalidraw`ファイルをダブルクリックすると、アプリ内で直接開くことができます。Windows（NSISインストーラー版）の場合はインストール時に確認画面が表示されますが、macOSおよびLinuxでは自動的に処理されます。

## 開発
プロジェクトをビルドする前に、以下の前提条件がインストールされていることを確認してください：

- Node.js（バージョン22.12.0以上）
- npm（Node.jsに同梱）

リポジトリをクローンします：
```bash
git clone https://github.com/pgkt04/excalidraw-desktop.git
cd excalidraw-desktop
```

依存関係をインストールします：
```bash
npm install
```

### 実行
開発モードでアプリを実行するには：
```bash
npm start
```

### ビルド
本番用のビルドを作成するには：

| コマンド | プラットフォーム | 出力 |
|---------|----------|--------|
| `npm run dist` | 現在のOS | プラットフォームによる |
| `npm run dist:mac` | macOS | `.dmg` (arm64) |
| `npm run dist:win` | Windows | Portable `.exe` + NSIS Setup `.exe` |
| `npm run dist:linux` | Linux | `.AppImage` + `.deb` |

生成されたインストーラーは`dist/`フォルダに保存されます。
