#!/bin/sh
set -eu

# Xcode Cloud must prepare the same locked native project as the repository gate.
# Generated shell assets/configuration are not old portal copies or credentials.
cd "${CI_PRIMARY_REPOSITORY_PATH:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel)}"
if ! command -v node >/dev/null 2>&1; then
    if ! command -v brew >/dev/null 2>&1; then
        echo 'Node 22 and Homebrew are unavailable. Configure the existing Xcode Cloud build environment before retrying.' >&2
        exit 1
    fi
    brew install node@22
    PATH="$(brew --prefix node@22)/bin:$PATH"
    export PATH
fi
node -e 'const v=process.versions.node.split(".").map(Number);if(v[0]<22||(v[0]===22&&v[1]<13))throw Error("Node 22.13 or later is required for the locked Capacitor toolchain")'
npm ci --include=dev --ignore-scripts
npx cap sync ios
node scripts/ios-native-contract-test.js --prepared
