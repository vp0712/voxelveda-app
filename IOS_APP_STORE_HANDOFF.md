# Voxel Veda iOS App Store Handoff

This project now includes the Capacitor iOS platform under `ios/`. The Windows machine can prepare and sync the project, but final iOS build, signing, TestFlight upload, and App Store submission must be completed on a Mac with Xcode.

## Current iOS Setup

- App name: Voxel Veda
- Bundle ID: `com.voxelveda.app`
- Live web server: `https://app.voxelveda.com`
- iOS project: `ios/App/App.xcodeproj`
- Camera permission text is included for secure shift QR scanning.

## On This Windows Machine

Use these commands after future web changes:

```bash
npm install
npm run cap:sync:ios
```

## On The Mac

1. Install Xcode from the Mac App Store.
2. Sign into Xcode with the Apple Developer account.
3. Clone or copy this project onto the Mac.
4. Run:

```bash
npm install
npm run cap:sync:ios
npm run cap:open:ios
```

5. In Xcode, open the `App` target.
6. Set Team to the Apple Developer team.
7. Confirm Bundle Identifier: `com.voxelveda.app`.
8. Set version/build number for the release.
9. Connect the iPhone and run the app for testing.
10. Test login, mobile sidebar, QR scanner, invoices, staff clock in/out, and notifications.
11. Xcode menu: Product > Archive.
12. In Organizer, validate and upload to App Store Connect.
13. In App Store Connect, complete screenshots, privacy, age rating, support URL, and review notes.
14. Submit first to TestFlight, then production after testing.

## App Review Notes Suggestion

Voxel Veda is an operations management app for internal engineering workflows including RFQs, invoices, inventory, suppliers, expenses, staff tasks, roster, meetings, and QR-based shift attendance. Demo login can be provided to Apple review if required.

## Important

Do not publish iOS until camera QR scanning has been tested on a real iPhone. The app needs camera access for attendance verification.
