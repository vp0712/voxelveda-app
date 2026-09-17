# Loader and network stability behavior

- The original `/logo.png` remains the canonical untouched company logo.
- The full-screen brand loader is delayed so fast loads do not flash it.
- Background `fetch` and XHR requests do not trigger the full-screen loader.
- Offline/online transitions use a small status message and never call `location.reload()`.
- Reconnect emits `voxelveda:network-restored` for modules that want to refresh quietly.
- The logo is contained safely inside the circular loader stage and is never cropped, filtered, recoloured, transformed or animated.
