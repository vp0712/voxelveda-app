const {
  processWebhookPayload,
  verifyMetaSignature,
  verifyWebhookChallenge
} = require('../services/vomWhatsAppService');

exports.verify = (req, res) => {
  const challenge = verifyWebhookChallenge(req.query);
  if (challenge == null) return res.status(403).send('Verification failed');
  return res.status(200).send(challenge);
};

exports.receive = (req, res) => {
  if (!verifyMetaSignature(req.rawBody, req.get('x-hub-signature-256'))) {
    return res.status(401).json({ message: 'Invalid webhook signature' });
  }

  const payload = req.body;
  res.status(200).json({ received: true });

  setImmediate(() => {
    processWebhookPayload(payload).catch((error) => {
      console.error(`VOM webhook processing failed: ${error.code || error.message}`);
    });
  });
};
