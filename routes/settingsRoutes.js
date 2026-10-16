const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const requireStepUp = require('../middleware/stepUpMiddleware');
const { bodyContract } = require('../middleware/requestContractMiddleware');
const {
  ALLOWED_SETTINGS,
  getSettings,
  updateSettings
} = require('../controllers/settingsController');

const router = express.Router();
const categories = require('../services/checkoutSummaryService');
const categoryFields = ['request_id','expected_revision','name','site_id','role_scope','active','reason'];
function categoryHandler(method) {
  return async (req,res) => {
    try { return res.set('Cache-Control','no-store').json(await categories[method]({user:req.user,query:req.query,id:req.params.id,input:req.body,req})); }
    catch(error) { return res.status(error.statusCode||500).json({message:error.statusCode?error.message:'Work categories could not be loaded or saved. Retry.',code:error.statusCode?error.code:'WORK_CATEGORIES_UNAVAILABLE',fields:error.fields||undefined}); }
  };
}
router.get('/work-categories', authMiddleware, requireAnyPermission('MANAGE_USERS'), categoryHandler('listCategories'));
router.post('/work-categories', authMiddleware, requireAnyPermission('MANAGE_USERS'), requireStepUp('CHANGE_SYSTEM_SETTINGS'), bodyContract(categoryFields,{required:['request_id','name','reason']}), categoryHandler('saveCategory'));
router.post('/work-categories/:id', authMiddleware, requireAnyPermission('MANAGE_USERS'), requireStepUp('CHANGE_SYSTEM_SETTINGS'), bodyContract(categoryFields,{required:['request_id','expected_revision','name','reason']}), categoryHandler('saveCategory'));

router.get('/', authMiddleware, requireAnyPermission('MANAGE_USERS'), getSettings);
router.post('/', authMiddleware, requireAnyPermission('MANAGE_USERS'), requireStepUp('CHANGE_SYSTEM_SETTINGS'), bodyContract(ALLOWED_SETTINGS), updateSettings);

module.exports = router;
