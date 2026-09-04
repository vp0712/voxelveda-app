const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const auth = require('../middleware/auth');
const { authRateLimit } = require('../middleware/securityMiddleware');
const securityAuthController = require('../controllers/securityAuthController');
const mfaController = require('../controllers/mfaController');

/* ================= AUTH ================= */

router.post('/login', authRateLimit(), authController.login);
router.post('/password-reset/request', authRateLimit(), securityAuthController.requestPasswordReset);
router.post('/password-reset/complete', authRateLimit(), securityAuthController.completePasswordReset);
router.post('/invitation/accept', authRateLimit(), securityAuthController.acceptInvitation);
router.post('/mfa/setup/start', authRateLimit(), mfaController.beginChallengeSetup);
router.post('/mfa/setup/confirm', authRateLimit(), mfaController.confirmChallengeSetup);
router.post('/mfa/verify', authRateLimit(), mfaController.verifyLogin);
router.post('/logout', authController.logout);
router.post('/customer-register', authRateLimit(), (req, res, next) => {
  if (process.env.ALLOW_PUBLIC_CUSTOMER_REGISTRATION !== 'true') {
    return res.status(404).json({ message: 'Registration is not available' });
  }
  return next();
}, authController.customerRegister);

router.get('/me', auth, authController.me);
router.post('/change-password', authRateLimit(), auth, securityAuthController.changePassword);
router.get('/sessions', auth, securityAuthController.getSessions);
router.delete('/sessions/:id', auth, securityAuthController.revokeOwnSession);
router.post('/sessions/revoke-others', auth, securityAuthController.revokeOtherSessions);
router.get('/mfa/status', auth, mfaController.status);
router.post('/mfa/enroll/start', authRateLimit(), auth, mfaController.beginEnrollment);
router.post('/mfa/enroll/confirm', authRateLimit(), auth, mfaController.confirmEnrollment);
router.post('/mfa/recovery/regenerate', authRateLimit(), auth, mfaController.regenerateRecoveryCodes);
router.delete('/mfa', authRateLimit(), auth, mfaController.disable);

module.exports = router;
