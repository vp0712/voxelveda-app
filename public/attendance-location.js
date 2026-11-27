(() => {
  'use strict';

  const maxAge = 45000;
  const unavailable = 'Your current location could not be read. Turn on location services and try again.';
  const denied = 'Location access was denied. Allow location for this site in your browser or device settings and try again.';
  const foreground = 'Keep this attendance page open while sharing your current location.';

  function isFresh(sample) {
    const age = Date.now() - Date.parse(sample?.captured_at);
    return !document.hidden && age >= 0 && age <= maxAge;
  }

  function capture() {
    return new Promise((resolve, reject) => {
      if (document.hidden) return reject(new Error(foreground));
      if (!navigator.geolocation) return reject(new Error(unavailable));

      navigator.geolocation.getCurrentPosition(position => {
        if (document.hidden) return reject(new Error(foreground));
        const { latitude, longitude, accuracy } = position.coords;
        if (!Number.isFinite(position.timestamp) || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
            !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isFinite(accuracy) || accuracy < 0) {
          return reject(new Error(unavailable));
        }
        const sample = { latitude, longitude, accuracy, captured_at: new Date(position.timestamp).toISOString() };
        if (!isFresh(sample)) return reject(new Error(unavailable));
        resolve(sample);
      }, error => reject(new Error(error.code === 1 ? denied : unavailable)), {
        enableHighAccuracy: true, maximumAge: 0, timeout: 12000
      });
    });
  }

  window.VoxelAttendanceLocation = { capture, isFresh };
})();
