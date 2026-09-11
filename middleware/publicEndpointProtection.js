const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@]{2,63}$/;
const COC_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{0,79}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const AUTH_IDENTITY_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~@-]{1,254}$/;
const AUTH_CODE_PATTERN = /^[A-Za-z0-9-]{6,64}$/;

function byteLength(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.length;
  const header = Number(req.headers?.['content-length']);
  return Number.isFinite(header) && header >= 0 ? header : 0;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function unknownFields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ['body'];
  const accepted = new Set([...allowed, 'bot_challenge_token']);
  return Object.keys(body).filter((key) => !accepted.has(key));
}

function validationError(res, message, fields = []) {
  return res.status(400).json({
    code: 'REQUEST_VALIDATION_FAILED',
    message,
    ...(fields.length ? { fields } : {})
  });
}

function requestContract({ maxBytes, allowedFields, validate }) {
  return (req, res, next) => {
    if (byteLength(req) > maxBytes) return validationError(res, 'Request body is too large');
    const unexpected = unknownFields(req.body, allowedFields);
    if (unexpected.length) return validationError(res, 'Request contains unsupported fields', unexpected);
    const result = validate(req);
    if (result) return validationError(res, result.message, result.fields || []);
    return next();
  };
}

const publicRfqContract = requestContract({
  maxBytes: 16 * 1024,
  allowedFields: ['customer_name', 'email', 'phone', 'material', 'quantity', 'application'],
  validate(req) {
    const body = req.body || {};
    const quantity = Number(body.quantity);
    if (!text(body.customer_name) || text(body.customer_name).length > 120) return { message: 'Customer name must be between 1 and 120 characters', fields: ['customer_name'] };
    if (!EMAIL_PATTERN.test(text(body.email)) || text(body.email).length > 254) return { message: 'A valid email address is required', fields: ['email'] };
    if (text(body.phone).length > 40) return { message: 'Phone number is too long', fields: ['phone'] };
    if (text(body.material).length > 160) return { message: 'Material is too long', fields: ['material'] };
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000000) return { message: 'Quantity must be a whole number between 1 and 1,000,000', fields: ['quantity'] };
    if (text(body.application).length > 4000) return { message: 'Application details are too long', fields: ['application'] };
    return null;
  }
});

const aiLeadContract = requestContract({
  maxBytes: 32 * 1024,
  allowedFields: ['name', 'email', 'phone', 'company', 'need', 'source', 'page', 'transcript'],
  validate(req) {
    const body = req.body || {};
    if (!text(body.name) || text(body.name).length > 120) return { message: 'Name must be between 1 and 120 characters', fields: ['name'] };
    if (!EMAIL_PATTERN.test(text(body.email)) || text(body.email).length > 254) return { message: 'A valid email address is required', fields: ['email'] };
    if (!text(body.need) || text(body.need).length > 1500) return { message: 'Project need must be between 1 and 1,500 characters', fields: ['need'] };
    if (text(body.phone).length > 80 || text(body.company).length > 160 || text(body.source).length > 120 || text(body.page).length > 500) {
      return { message: 'One or more lead fields exceed the permitted length' };
    }
    if (body.transcript !== undefined && (!Array.isArray(body.transcript) || body.transcript.length > 12 || body.transcript.some((entry) => typeof entry !== 'string' || entry.length > 600))) {
      return { message: 'Transcript must contain at most 12 text entries of 600 characters', fields: ['transcript'] };
    }
    return null;
  }
});

const customerRegistrationContract = requestContract({
  maxBytes: 8 * 1024,
  allowedFields: ['name', 'email', 'password', 'confirm_privacy'],
  validate(req) {
    const body = req.body || {};
    if (!text(body.name) || text(body.name).length > 120) return { message: 'Name must be between 1 and 120 characters', fields: ['name'] };
    if (!EMAIL_PATTERN.test(text(body.email)) || text(body.email).length > 254) return { message: 'A valid email address is required', fields: ['email'] };
    if (typeof body.password !== 'string' || body.password.length > 256) return { message: 'Password is invalid', fields: ['password'] };
    if (body.confirm_privacy !== true) return { message: 'Please accept the privacy policy before creating an account', fields: ['confirm_privacy'] };
    return null;
  }
});

const loginContract = requestContract({
  maxBytes: 8 * 1024,
  allowedFields: ['email', 'password'],
  validate(req) {
    const body = req.body || {};
    if (!AUTH_IDENTITY_PATTERN.test(text(body.email))) return { message: 'A valid email or user ID is required', fields: ['email'] };
    if (typeof body.password !== 'string' || !body.password || body.password.length > 256) return { message: 'Password is required', fields: ['password'] };
    return null;
  }
});

const passwordResetRequestContract = requestContract({
  maxBytes: 4 * 1024,
  allowedFields: ['email'],
  validate(req) {
    return AUTH_IDENTITY_PATTERN.test(text(req.body?.email)) ? null : { message: 'A valid email or user ID is required', fields: ['email'] };
  }
});

const passwordTokenContract = requestContract({
  maxBytes: 8 * 1024,
  allowedFields: ['token', 'password'],
  validate(req) {
    const token = text(req.body?.token);
    const password = req.body?.password;
    if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) return { message: 'Token and password are required', fields: ['token'] };
    if (typeof password !== 'string' || !password || password.length > 256) return { message: 'Token and password are required', fields: ['password'] };
    return null;
  }
});

const mfaChallengeStartContract = requestContract({
  maxBytes: 4 * 1024,
  allowedFields: ['challenge_token'],
  validate(req) {
    return /^[A-Za-z0-9_-]{32,200}$/.test(text(req.body?.challenge_token)) ? null : { message: 'The MFA setup session is invalid or expired', fields: ['challenge_token'] };
  }
});

const mfaCodeContract = requestContract({
  maxBytes: 4 * 1024,
  allowedFields: ['challenge_token', 'code'],
  validate(req) {
    if (!/^[A-Za-z0-9_-]{32,200}$/.test(text(req.body?.challenge_token))) return { message: 'Invalid or expired verification code', fields: ['challenge_token'] };
    if (!AUTH_CODE_PATTERN.test(text(req.body?.code))) return { message: 'Invalid or expired verification code', fields: ['code'] };
    return null;
  }
});

const passwordChangeContract = requestContract({
  maxBytes: 8 * 1024,
  allowedFields: ['current_password', 'new_password'],
  validate(req) {
    if (typeof req.body?.current_password !== 'string' || !req.body.current_password || req.body.current_password.length > 256) return { message: 'Current and new passwords are required', fields: ['current_password'] };
    if (typeof req.body?.new_password !== 'string' || !req.body.new_password || req.body.new_password.length > 256) return { message: 'Current and new passwords are required', fields: ['new_password'] };
    return null;
  }
});

const mfaAuthenticatedContract = requestContract({
  maxBytes: 4 * 1024,
  allowedFields: ['current_password', 'code'],
  validate(req) {
    if (req.body?.current_password !== undefined && (typeof req.body.current_password !== 'string' || !req.body.current_password || req.body.current_password.length > 256)) return { message: 'Security verification failed', fields: ['current_password'] };
    if (req.body?.code !== undefined && !AUTH_CODE_PATTERN.test(text(req.body.code))) return { message: 'Security verification failed', fields: ['code'] };
    return null;
  }
});

const stepUpContract = requestContract({
  maxBytes: 4 * 1024,
  allowedFields: ['password', 'code'],
  validate(req) {
    if (typeof req.body?.password !== 'string' || !req.body.password || req.body.password.length > 256) return { message: 'Password and a six-digit authenticator code are required.', fields: ['password'] };
    if (!/^\d{6}$/.test(text(req.body?.code))) return { message: 'Password and a six-digit authenticator code are required.', fields: ['code'] };
    return null;
  }
});

function qrGenerationContract(req, res, next) {
  const keys = Object.keys(req.query || {});
  if (keys.some((key) => key !== 'data')) return validationError(res, 'QR request contains unsupported parameters', keys.filter((key) => key !== 'data'));
  const data = text(req.query?.data);
  if (!data || data.length > 1200 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(data)) {
    return validationError(res, 'QR data must contain between 1 and 1,200 safe text characters', ['data']);
  }
  return next();
}

function shiftQrContract(req, res, next) {
  const keys = Object.keys(req.query || {});
  if (keys.some((key) => key !== 't')) return validationError(res, 'Shift QR request contains unsupported parameters', keys.filter((key) => key !== 't'));
  if (req.query?.t !== undefined && !/^\d{1,20}$/.test(String(req.query.t))) return validationError(res, 'Shift QR cache value is invalid', ['t']);
  return next();
}

function cocVerificationContract(req, res, next) {
  const number = text(req.params?.no);
  const hash = text(req.query?.hash);
  const keys = Object.keys(req.query || {});
  if (!COC_NUMBER_PATTERN.test(number)) return validationError(res, 'Certificate number format is invalid', ['no']);
  if (keys.some((key) => key !== 'hash')) return validationError(res, 'Certificate request contains unsupported parameters', keys.filter((key) => key !== 'hash'));
  if (hash && !SHA256_PATTERN.test(hash)) return validationError(res, 'Certificate integrity hash format is invalid', ['hash']);
  return next();
}

module.exports = {
  COC_NUMBER_PATTERN,
  EMAIL_PATTERN,
  SHA256_PATTERN,
  aiLeadContract,
  cocVerificationContract,
  customerRegistrationContract,
  loginContract,
  mfaAuthenticatedContract,
  mfaChallengeStartContract,
  mfaCodeContract,
  passwordChangeContract,
  passwordResetRequestContract,
  passwordTokenContract,
  publicRfqContract,
  qrGenerationContract,
  requestContract,
  shiftQrContract,
  stepUpContract
};
