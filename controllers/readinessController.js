const { detailedReadiness, liveness, publicReadiness } = require('../services/runtimeState');

exports.health = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return res.status(200).json(liveness());
};

exports.ready = (req, res) => {
  const readiness = publicReadiness();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return res.status(readiness.ready ? 200 : 503).json(readiness);
};

exports.details = (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json(detailedReadiness());
};
