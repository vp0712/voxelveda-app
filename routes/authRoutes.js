const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleMiddleware');
const { authRateLimit } = require('../middleware/securityMiddleware');

/* ================= AUTH ================= */

router.post('/login', authRateLimit(), authController.login);
router.post('/logout', authController.logout);
router.post('/session', auth, authController.refreshSessionCookie);

router.post('/register', authRateLimit(), auth, requireRole('admin'), authController.register);

router.post('/customer-register', authRateLimit(), authController.customerRegister);

router.get('/me', auth, authController.me);

module.exports = router;
