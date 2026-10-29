# Android APK / 安卓安装包

This repo contains a **prebuilt static web game**, not an Android or Capacitor
project. The new `app/` module wraps the existing files in an Android WebView
and includes them **inside** the APK. No server, internet permission, or Node
build is required. It opens in landscape, and game saves stay in the Android
app's WebView storage.

## Build with GitHub Actions (easiest)

1. Open **Actions** in this repository and choose **Build Android APK**.
2. Select **Run workflow** and the branch you want to build, or push changes
   to `main` (the workflow also builds on pull requests).
3. Once the run finishes successfully, open its **Artifacts** section.
4. Download **sudoku-mansion-debug-apk** (ZIP) and extract `app-debug.apk`.
5. Transfer the APK to your Android phone and install it (allow installation
   from that source when Android prompts).

The artifact is an **installable debug APK**, not a Play Store release. It is
automatically signed with a CI-generated debug key. **A later CI build may use
a different debug signing key**, so Android may refuse to install it over an
older build. Uninstalling the old APK deletes its WebView game saves.
Export your saves before uninstalling, or set up persistent release signing
before distributing regular updates.

## Build locally

Requires JDK 17, Android SDK Platform 35 and Build Tools 35.0.0, and Gradle
8.9 (or open the project in a compatible Android Studio). At the repo root:

```sh
gradle :app:assembleDebug
```

Output: `app/build/outputs/apk/debug/app-debug.apk`.

The `syncWebAssets` Gradle task automatically copies the website files
(`index.html`, root JS/CSS/images, `assets/`, and `media/`) into the
build's generated assets before APK packaging. Edit the existing web files
normally; no second copy is checked in.

## Notes

- Package ID: `com.fanfront.sudokumansion`; Android 7.0+ (API 24+).
- Android WebView must be present and reasonably up to date.
- Game saves inside the APK are **separate** from saves in Chrome/GitHub Pages.
- The repository explicitly omits large music/audio files; the APK cannot
  include audio that is not in the repository.
- This setup produces an offline APK for **personal testing**. Check the
  game's redistribution rights before publishing a binary.
