const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const auth = require('../middleware/auth');
const { authRateLimit } = require('../middleware/securityMiddleware');
const {
  customerRegistrationContract,
  loginContract,
  mfaAuthenticatedContract,
  mfaChallengeStartContract,
  mfaCodeContract,
  passwordChangeContract,
  passwordResetRequestContract,
  passwordTokenContract,
  stepUpContract
} = require('../middleware/publicEndpointProtection');
const { botChallenge } = require('../services/botChallengeService');
const securityAuthController = require('../controllers/securityAuthController');
const mfaController = require('../controllers/mfaController');
const stepUpController = require('../controllers/stepUpController');

/* ================= AUTH ================= */

router.post('/login', authRateLimit(), loginContract, botChallenge('login'), authController.login);
router.post('/password-reset/request', authRateLimit(), passwordResetRequestContract, botChallenge('password_reset_request'), securityAuthController.requestPasswordReset);
router.post('/password-reset/complete', authRateLimit(), passwordTokenContract, securityAuthController.completePasswordReset);
router.post('/invitation/accept', authRateLimit(), passwordTokenContract, securityAuthController.acceptInvitation);
router.post('/mfa/setup/start', authRateLimit(), mfaChallengeStartContract, mfaController.beginChallengeSetup);
router.post('/mfa/setup/confirm', authRateLimit(), mfaCodeContract, mfaController.confirmChallengeSetup);
router.post('/mfa/verify', authRateLimit(), mfaCodeContract, mfaController.verifyLogin);
router.post('/logout', authController.logout);
router.post('/customer-register', authRateLimit(), (req, res, next) => {
  if (process.env.ALLOW_PUBLIC_CUSTOMER_REGISTRATION !== 'true') {
    return res.status(404).json({ message: 'Registration is not available' });
  }
  return next();
}, customerRegistrationContract, botChallenge('customer_registration'), authController.customerRegister);

router.get('/me', auth, authController.me);
router.post('/change-password', authRateLimit(), auth, passwordChangeContract, securityAuthController.changePassword);
router.get('/sessions', auth, securityAuthController.getSessions);
router.delete('/sessions/:id', auth, securityAuthController.revokeOwnSession);
router.post('/sessions/revoke-others', auth, securityAuthController.revokeOtherSessions);
router.get('/mfa/status', auth, mfaController.status);
router.post('/mfa/enroll/start', authRateLimit(), auth, mfaAuthenticatedContract, mfaController.beginEnrollment);
router.post('/mfa/enroll/confirm', authRateLimit(), auth, mfaAuthenticatedContract, mfaController.confirmEnrollment);
router.post('/mfa/recovery/regenerate', authRateLimit(), auth, mfaAuthenticatedContract, mfaController.regenerateRecoveryCodes);
router.delete('/mfa', authRateLimit(), auth, mfaAuthenticatedContract, mfaController.disable);
router.get('/step-up/status', auth, stepUpController.status);
router.post('/step-up', authRateLimit(), auth, stepUpContract, stepUpController.verify);

module.exports = router;
