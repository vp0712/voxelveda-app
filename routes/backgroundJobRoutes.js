const express = require('express');
const controller = require('../controllers/backgroundJobController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const requireStepUp = require('../middleware/stepUpMiddleware');
const { bodyContract } = require('../middleware/requestContractMiddleware');

const router = express.Router();

router.use(requireAnyPermission('MANAGE_BACKGROUND_JOBS'));
router.get('/', controller.health);
router.get('/dead-letters', controller.deadLetters);
router.post(
  '/dead-letters/:id/retry',
  requireStepUp('RETRY_BACKGROUND_JOB'),
  bodyContract(['reason'], { required: ['reason'] }),
  controller.retryDeadLetter
);

module.exports = router;
