const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const expenseController = require('../controllers/expenseController');
const requireInputPermission = require('../middleware/inputPermissionMiddleware');
const { sanitizeUploadName, secureMulterOptions } = require('../middleware/uploadSecurity');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'uploads', 'expenses');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const safeName = sanitizeUploadName(file.originalname);
    cb(null, `expense_${req.params.id || 'new'}_${Date.now()}_${safeName}`);
  }
});

const upload = multer(secureMulterOptions(storage, 12));

router.get('/', expenseController.getExpenses);
router.get('/:id/payments', expenseController.getExpensePayments);
router.get('/files/:id/view', expenseController.viewExpenseFile);
router.post('/', requireInputPermission('expenses_input'), expenseController.saveExpense);
router.post('/:id/payments', requireInputPermission('expenses_input'), expenseController.recordExpensePayment);
router.post('/payments/:paymentId/void', requireInputPermission('expenses_input'), expenseController.voidExpensePayment);
router.post('/delete', requireInputPermission('expenses_input'), expenseController.deleteExpense);
router.post('/:id/files', requireInputPermission('expenses_input'), upload.single('file'), expenseController.saveExpenseFile);
router.post('/files/delete', requireInputPermission('expenses_input'), expenseController.deleteExpenseFile);

module.exports = router;
