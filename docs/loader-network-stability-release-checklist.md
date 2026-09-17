# Loader/network release checklist

1. Original `/logo.png` remains byte-identical.
2. Logo is contained inside the circular stage without clipping.
3. Background fetch/XHR does not show the full-screen loader.
4. Online reconnect does not hard reload the page.
5. Offline/online state is communicated with a small non-blocking status pill.
6. Full-screen loader is delayed and has a minimum visible duration only when it actually appears.
7. Whole-system audit and security CI must pass before merge.
