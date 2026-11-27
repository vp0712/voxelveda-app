# Staff attendance on qr.voxelveda.com

The QR site uses the existing Voxel Veda service, database, workplace display and attendance transactions. The base address opens phone setup or scan instructions. Staff confirm attendance after scanning the rotating workplace code. The host exposes only its small set of staff pages and attendance endpoints.

## Release

1. Apply the patch in the vp0712/voxelveda-app checkout and run the current PR checks. The source baseline is 0789e82898a84ae6b7d946e9c79a9a1ed8b370f4. If the branch has moved, review any conflicting changes before applying.
2. In the existing Railway production service set QR_STAFF_ORIGIN=https://qr.voxelveda.com and QR_STAFF_EMIT=false. Keep the existing canonical app URL, attendance signing key, workplace ID, database and port. The app creates the additive attendance_phone_links InnoDB table on first use. Its database account needs the same normal schema capabilities as the existing attendance module.
3. Deploy the checked and merged commit using the repo's release-marker workflow. Confirm Railway shows a valid certificate for the QR hostname. Open the QR root in a fresh phone browser. It should show staff attendance and phone linking. The main portal should still open normally at app.voxelveda.com.
4. Have a designated test staff member link their phone while the old workplace QR is still being issued. For a controlled smoke test, open a freshly issued workplace scan URL on the QR hostname with the exact same path and query on that phone. Keep the token private and within its short lifetime. Confirm check-in, then use a fresh code to check out and verify the one timesheet row. Do this with an authorised test identity and the intended workplace.
5. Set QR_STAFF_EMIT=true through the existing release process after that pilot. The workplace display will issue URLs on the new hostname. Test an ordinary iPhone camera and an Android phone with the installed Voxel Veda app, including the return from first-time approval to the same browser. Use the existing manual private-display check with its scan_origin input set to https://qr.voxelveda.com.

To return new scans to the existing portal, set QR_STAFF_EMIT=false. Removing QR_STAFF_ORIGIN also disables the dedicated site on the deployed code. Attendance records remain in the normal attendance table.

## Staff

1. On a personal phone, open the QR site, choose **Link this phone**, sign in to Operations Hub and complete its normal MFA if prompted. Choose **Link my phone**. Use the same phone browser to complete this step.
2. Scan the current QR on the workplace tablet. Check the displayed staff member and workplace, then tap **Check in** or **Check out**. A refresh or reopening the base address does not record a punch.
3. The result shows the recorded time in the company time zone. If the network fails, check the saved status or rescan a fresh code to retry the same action. A stored request ID lets the server return the existing receipt.
4. Use **Wrong person? Unlink this phone** on that phone, or **Account Security → Manage attendance phones** in the Hub to revoke all of your attendance phones after loss or replacement. Phone credentials last 30 days; revocation, account changes and loss of eligibility can end access earlier.

## Administration and tests

Keep the existing tablet's private display bookmark. The Hub's Shift QR Control → Display settings → Manage display links remains the place to create or replace it. A printed QR pointing to the root is suitable for phone setup. The original logo and rotating signed workplace code are used for attendance.

- Install locked packages with npm ci and run npm run build from the repo root.
- Mobile browser fixture: node scripts/qr-staff-browser-test.js with Playwright and Chromium available. VV_BROWSER_MODULE_PATH and VV_CHROMIUM_PATH can select existing test installations.
- Phone credential and concurrency test: QR_PHONE_TEST=1 DB_PORT=3307 node scripts/qr-phone-mysql-test.js on a local disposable MySQL server with permission to create its temporary schema. Set DB_USER and DB_PASSWORD for that local server if required.
- Full HTTP-to-timesheet test: in the existing localhost MySQL 8.4 regression environment (NODE_ENV=test, REPAIR_DB_TEST=true, DB_NAME=voxelveda_repair_test), run node scripts/qr-staff-timesheet-mysql-test.js after the retained schema fixture. It creates a synthetic user, verifies two confirmed actions and checks the actual weekly endpoint after one minute of server time.
