const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const careers = require('../controllers/careersController');
const { sanitizeUploadName, secureMulterOptions, validateUploadedFile } = require('../middleware/uploadSecurity');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const { rateLimit } = require('../middleware/securityMiddleware');

const publicRouter = express.Router();
const adminRouter = express.Router();
const uploadDir = path.join(__dirname, '..', 'uploads', 'careers');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination(req, file, cb) { cb(null, uploadDir); },
  filename(req, file, cb) { cb(null, `career_${Date.now()}_${sanitizeUploadName(file.originalname)}`); }
});
const upload = multer(secureMulterOptions(storage, 10));
const applicantLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 8, keyPrefix: 'public:careers' });

publicRouter.get('/jobs', careers.listPublicJobs);
publicRouter.get('/jobs/:slug', careers.getPublicJob);
publicRouter.post('/applications', applicantLimit, upload.single('resume'), validateUploadedFile, careers.submitApplication);

adminRouter.use(requireAnyPermission('VIEW_STAFF_HR', 'MANAGE_USERS'));
adminRouter.get('/jobs', careers.listAdminJobs);
adminRouter.patch('/jobs/:id/status', careers.setJobStatus);
adminRouter.get('/applications', careers.listApplications);
adminRouter.patch('/applications/:id/status', careers.updateApplicationStatus);

module.exports = { publicRouter, adminRouter };
