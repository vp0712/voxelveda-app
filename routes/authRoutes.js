const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roleMiddleware');

/* ================= AUTH ================= */

router.post('/login', authController.login);

router.post('/register', auth, requireRole('admin'), authController.register);

router.get('/me', auth, authController.me);

module.exports = router;
