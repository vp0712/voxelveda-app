const crypto = require('node:crypto');
const pool = require('../config/db');

function userId(req) {
  const value = req.user?.id ?? req.user?.user_id;
  if (value === undefined || value === null || value === '') throw Object.assign(new Error('User identity unavailable.'), { statusCode: 401 });
  return String(value);
}
function clean(value, max) { return String(value || '').trim().slice(0, max); }
function fail(res, error, fallback) {
  const status = Number(error?.statusCode || 500);
  if (status >= 500) console.error(fallback, error);
  return res.status(status).json({ message: status >= 500 ? fallback : error.message });
}

exports.list = async (req, res) => {
  try {
    const uid = userId(req);
    const [rows] = await pool.query(
      `SELECT id,name,query_text,pinned,sort_order,last_opened_at,created_at,updated_at
       FROM personal_finance_saved_views WHERE user_id=?
       ORDER BY pinned DESC, sort_order ASC, updated_at DESC`, [uid]
    );
    res.json({
      privacy: 'Saved views are owner-private and store only the search definition, not transaction snapshots.',
      saved_views: rows.map(r => ({ ...r, pinned: Boolean(r.pinned) }))
    });
  } catch (error) { return fail(res, error, 'Failed to load saved finance views.'); }
};

exports.create = async (req, res) => {
  try {
    const uid = userId(req);
    const name = clean(req.body.name, 120);
    const query = clean(req.body.query_text, 180);
    if (!name) throw Object.assign(new Error('View name is required.'), { statusCode: 400 });
    if (query.length < 2) throw Object.assign(new Error('Saved search must contain at least two characters.'), { statusCode: 400 });
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO personal_finance_saved_views (id,user_id,name,query_text,pinned,sort_order)
       VALUES (?,?,?,?,?,?)`,
      [id, uid, name, query, req.body.pinned === false ? 0 : 1, Number(req.body.sort_order || 0)]
    );
    res.status(201).json({ message: 'Smart View saved.', id });
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'You already have a saved view with this name.' });
    return fail(res, error, 'Failed to save finance view.');
  }
};

exports.update = async (req, res) => {
  try {
    const uid = userId(req);
    const [[existing]] = await pool.query(`SELECT * FROM personal_finance_saved_views WHERE id=? AND user_id=?`, [req.params.id, uid]);
    if (!existing) throw Object.assign(new Error('Saved view not found.'), { statusCode: 404 });
    const name = req.body.name === undefined ? existing.name : clean(req.body.name, 120);
    const query = req.body.query_text === undefined ? existing.query_text : clean(req.body.query_text, 180);
    if (!name || query.length < 2) throw Object.assign(new Error('View name and search text are required.'), { statusCode: 400 });
    const pinned = req.body.pinned === undefined ? existing.pinned : (req.body.pinned ? 1 : 0);
    const order = req.body.sort_order === undefined ? existing.sort_order : Number(req.body.sort_order || 0);
    await pool.query(
      `UPDATE personal_finance_saved_views SET name=?,query_text=?,pinned=?,sort_order=? WHERE id=? AND user_id=?`,
      [name, query, pinned, order, existing.id, uid]
    );
    res.json({ message: 'Smart View updated.' });
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'You already have a saved view with this name.' });
    return fail(res, error, 'Failed to update finance view.');
  }
};

exports.opened = async (req, res) => {
  try {
    const uid = userId(req);
    const [result] = await pool.query(`UPDATE personal_finance_saved_views SET last_opened_at=NOW() WHERE id=? AND user_id=?`, [req.params.id, uid]);
    if (!result.affectedRows) throw Object.assign(new Error('Saved view not found.'), { statusCode: 404 });
    res.json({ message: 'Smart View refreshed.' });
  } catch (error) { return fail(res, error, 'Failed to refresh finance view.'); }
};

exports.remove = async (req, res) => {
  try {
    const uid = userId(req);
    const [result] = await pool.query(`DELETE FROM personal_finance_saved_views WHERE id=? AND user_id=?`, [req.params.id, uid]);
    if (!result.affectedRows) throw Object.assign(new Error('Saved view not found.'), { statusCode: 404 });
    res.json({ message: 'Smart View deleted.' });
  } catch (error) { return fail(res, error, 'Failed to delete finance view.'); }
};
