const express = require('express');
const multer = require('multer');
const { bodyContract } = require('../middleware/requestContractMiddleware');
const {
  getMyProfile,
  updateMyProfile,
  uploadMyProfilePhoto,
  getMyProfilePhoto,
  deleteMyProfilePhoto
} = require('../controllers/profileController');

const router = express.Router();
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(String(file.mimetype || '').toLowerCase())) {
      return callback(new Error('Only JPG, PNG and WebP profile photos are allowed'));
    }
    return callback(null, true);
  }
});

function singlePhoto(req, res, next) {
  photoUpload.single('photo')(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: 'Profile photo must be 5 MB or smaller' });
    return res.status(400).json({ message: error.message || 'Profile photo could not be uploaded' });
  });
}

router.get('/', getMyProfile);
router.post('/', bodyContract(['name', 'mobile_number'], { required: ['name'] }), updateMyProfile);
router.get('/photo', getMyProfilePhoto);
router.post('/photo', singlePhoto, uploadMyProfilePhoto);
router.delete('/photo', deleteMyProfilePhoto);

module.exports = router;
