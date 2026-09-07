const { acceptWebhook } = require('../services/webhookSecurityService');

exports.receive = async (req, res) => {
  try {
    const source = String(req.params.source || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{2,79}$/.test(source)) return res.status(404).json({ message: 'Webhook source unavailable' });
    const result = await acceptWebhook(req, source);
    return res.status(result.duplicate ? 200 : 202).json({ accepted: true, duplicate: result.duplicate, event_id: result.eventId });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Webhook could not be accepted' });
  }
};
