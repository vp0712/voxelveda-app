const pool = require('../config/db');

async function ensureStockTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_batches (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_name VARCHAR(180) NOT NULL,
      category VARCHAR(120) NULL,
      batch_code VARCHAR(120) NOT NULL,
      manufacture_date DATE NULL,
      expiry_date DATE NULL,
      box_qty INT NOT NULL DEFAULT 0,
      unit_qty INT NOT NULL DEFAULT 0,
      box_price DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
      created_by INT NULL,
      updated_by INT NULL,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`ALTER TABLE stock_batches ADD COLUMN current_unit_qty INT NOT NULL DEFAULT 0`).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      stock_id INT NOT NULL,
      movement_type VARCHAR(40) NOT NULL DEFAULT 'issue',
      quantity INT NOT NULL,
      unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
      total_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      issued_to VARCHAR(180) NULL,
      notes TEXT NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    UPDATE stock_batches s
    LEFT JOIN stock_movements m ON m.stock_id = s.id
    SET s.current_unit_qty = s.unit_qty
    WHERE s.current_unit_qty = 0
    AND s.unit_qty > 0
    AND m.id IS NULL
  `);
}

exports.getStock = async (req, res) => {
  try {
    await ensureStockTable();

    const search = String(req.query.search || '').trim();
    const params = [];
    let where = 'WHERE IFNULL(s.deleted, 0) = 0';

    if (search) {
      where += ` AND (
        s.product_name LIKE ?
        OR s.category LIKE ?
        OR s.batch_code LIKE ?
      )`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [rows] = await pool.query(
      `
      SELECT
        s.*,
        (s.unit_qty * s.unit_price) AS total_input_value,
        (s.current_unit_qty * s.unit_price) AS current_value,
        (s.unit_qty - s.current_unit_qty) AS issued_unit_qty,
        cu.name AS created_by_name,
        uu.name AS updated_by_name
      FROM stock_batches s
      LEFT JOIN users cu ON cu.id = s.created_by
      LEFT JOIN users uu ON uu.id = s.updated_by
      ${where}
      ORDER BY s.created_at DESC, s.id DESC
      `,
      params
    );

    res.json({ stock: rows });
  } catch (error) {
    console.error('getStock error:', error);
    res.status(500).json({ message: 'Failed to load stock', error: error.message });
  }
};

exports.saveStock = async (req, res) => {
  try {
    await ensureStockTable();

    const id = Number(req.body.id || 0);
    const productName = String(req.body.product_name || '').trim();
    const category = String(req.body.category || '').trim();
    const batchCode = String(req.body.batch_code || '').trim() || `STK-${Date.now()}`;
    const manufactureDate = String(req.body.manufacture_date || '').slice(0, 10) || null;
    const unitQty = Number(req.body.unit_qty || 0);
    const unitPrice = Number(req.body.unit_price || 0);

    if (!productName || !batchCode) {
      return res.status(400).json({ message: 'Product and batch code are required' });
    }

    if ([unitQty, unitPrice].some((value) => Number.isNaN(value) || value < 0)) {
      return res.status(400).json({ message: 'Stock quantities and prices must be valid positive numbers' });
    }

    if (id) {
      const [[existing]] = await pool.query(
        'SELECT unit_qty, current_unit_qty FROM stock_batches WHERE id = ? AND IFNULL(deleted, 0) = 0 LIMIT 1',
        [id]
      );

      if (!existing) {
        return res.status(404).json({ message: 'Stock batch not found' });
      }

      const alreadyIssued = Math.max(0, Number(existing.unit_qty || 0) - Number(existing.current_unit_qty || 0));
      if (unitQty < alreadyIssued) {
        return res.status(400).json({
          message: `Input quantity cannot be less than already issued quantity (${alreadyIssued})`
        });
      }

      const nextCurrentQty = Math.max(0, unitQty - alreadyIssued);

      const [result] = await pool.query(
        `
        UPDATE stock_batches
        SET product_name = ?,
            category = ?,
            batch_code = ?,
            manufacture_date = ?,
            unit_qty = ?,
            unit_price = ?,
            current_unit_qty = ?,
            updated_by = ?
        WHERE id = ?
        AND IFNULL(deleted, 0) = 0
        `,
        [productName, category, batchCode, manufactureDate, unitQty, unitPrice, nextCurrentQty, req.user.id, id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Stock batch not found' });
      }

      return res.json({ message: 'Stock batch updated successfully' });
    }

    const [result] = await pool.query(
      `
      INSERT INTO stock_batches
      (product_name, category, batch_code, manufacture_date, unit_qty, current_unit_qty, unit_price, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [productName, category, batchCode, manufactureDate, unitQty, unitQty, unitPrice, req.user.id]
    );

    res.json({
      message: 'Stock batch created successfully',
      stock_id: result.insertId
    });
  } catch (error) {
    console.error('saveStock error:', error);
    res.status(500).json({ message: 'Failed to save stock', error: error.message });
  }
};

exports.issueStock = async (req, res) => {
  const conn = await pool.getConnection();

  try {
    await ensureStockTable();

    const stockId = Number(req.body.stock_id);
    const quantity = Number(req.body.quantity || 0);
    const issuedTo = String(req.body.issued_to || '').trim();
    const notes = String(req.body.notes || '').trim();

    if (!stockId || quantity <= 0) {
      return res.status(400).json({ message: 'Stock item and issue quantity are required' });
    }

    if (!issuedTo) {
      return res.status(400).json({ message: 'Issued/sold to is required' });
    }

    await conn.beginTransaction();

    const [[stock]] = await conn.query(
      `
      SELECT id, product_name, current_unit_qty, unit_price
      FROM stock_batches
      WHERE id = ?
      AND IFNULL(deleted, 0) = 0
      FOR UPDATE
      `,
      [stockId]
    );

    if (!stock) {
      await conn.rollback();
      return res.status(404).json({ message: 'Stock item not found' });
    }

    if (Number(stock.current_unit_qty || 0) < quantity) {
      await conn.rollback();
      return res.status(400).json({ message: 'Not enough stock available' });
    }

    const unitPrice = Number(stock.unit_price || 0);
    const totalPrice = quantity * unitPrice;

    await conn.query(
      `
      UPDATE stock_batches
      SET current_unit_qty = current_unit_qty - ?,
          updated_by = ?
      WHERE id = ?
      `,
      [quantity, req.user.id, stockId]
    );

    const [movement] = await conn.query(
      `
      INSERT INTO stock_movements
      (stock_id, movement_type, quantity, unit_price, total_price, issued_to, notes, created_by)
      VALUES (?, 'issue', ?, ?, ?, ?, ?, ?)
      `,
      [stockId, quantity, unitPrice, totalPrice, issuedTo, notes, req.user.id]
    );

    await conn.commit();

    res.json({
      message: 'Stock issued successfully',
      movement_id: movement.insertId,
      total_price: totalPrice
    });
  } catch (error) {
    await conn.rollback();
    console.error('issueStock error:', error);
    res.status(500).json({ message: 'Failed to issue stock', error: error.message });
  } finally {
    conn.release();
  }
};

async function restoreMovementQuantity(conn, movement, userId) {
  await conn.query(
    `
    UPDATE stock_batches
    SET current_unit_qty = current_unit_qty + ?,
        updated_by = ?
    WHERE id = ?
    AND IFNULL(deleted, 0) = 0
    `,
    [Number(movement.quantity || 0), userId, movement.stock_id]
  );
}

exports.updateStockMovement = async (req, res) => {
  const conn = await pool.getConnection();

  try {
    await ensureStockTable();

    const movementId = Number(req.body.id || 0);
    const stockId = Number(req.body.stock_id || 0);
    const quantity = Number(req.body.quantity || 0);
    const issuedTo = String(req.body.issued_to || '').trim();
    const notes = String(req.body.notes || '').trim();

    if (!movementId || !stockId || quantity <= 0) {
      return res.status(400).json({ message: 'Stock out entry, item, and quantity are required' });
    }

    if (!issuedTo) {
      return res.status(400).json({ message: 'Issued/sold to is required' });
    }

    await conn.beginTransaction();

    const [[movement]] = await conn.query(
      `
      SELECT id, stock_id, quantity, created_by
      FROM stock_movements
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [movementId]
    );

    if (!movement) {
      await conn.rollback();
      return res.status(404).json({ message: 'Stock out entry not found' });
    }

    await restoreMovementQuantity(conn, movement, req.user.id);

    const [[stock]] = await conn.query(
      `
      SELECT id, current_unit_qty, unit_price
      FROM stock_batches
      WHERE id = ?
      AND IFNULL(deleted, 0) = 0
      FOR UPDATE
      `,
      [stockId]
    );

    if (!stock) {
      await conn.rollback();
      return res.status(404).json({ message: 'Stock item not found' });
    }

    if (Number(stock.current_unit_qty || 0) < quantity) {
      await conn.rollback();
      return res.status(400).json({ message: 'Not enough stock available for this correction' });
    }

    const unitPrice = Number(stock.unit_price || 0);
    const totalPrice = quantity * unitPrice;

    await conn.query(
      `
      UPDATE stock_batches
      SET current_unit_qty = current_unit_qty - ?,
          updated_by = ?
      WHERE id = ?
      `,
      [quantity, req.user.id, stockId]
    );

    await conn.query(
      `
      UPDATE stock_movements
      SET stock_id = ?,
          quantity = ?,
          unit_price = ?,
          total_price = ?,
          issued_to = ?,
          notes = ?
      WHERE id = ?
      `,
      [stockId, quantity, unitPrice, totalPrice, issuedTo, notes, movementId]
    );

    await conn.commit();
    res.json({ message: 'Stock out entry updated successfully' });
  } catch (error) {
    await conn.rollback();
    console.error('updateStockMovement error:', error);
    res.status(500).json({ message: 'Failed to update stock out entry', error: error.message });
  } finally {
    conn.release();
  }
};

exports.deleteStockMovement = async (req, res) => {
  const conn = await pool.getConnection();

  try {
    await ensureStockTable();

    const movementId = Number(req.body.id || 0);

    if (!movementId) {
      return res.status(400).json({ message: 'Stock out entry ID is required' });
    }

    await conn.beginTransaction();

    const [[movement]] = await conn.query(
      `
      SELECT id, stock_id, quantity, created_by
      FROM stock_movements
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [movementId]
    );

    if (!movement) {
      await conn.rollback();
      return res.status(404).json({ message: 'Stock out entry not found' });
    }

    await conn.query(
      `
      UPDATE stock_batches
      SET current_unit_qty = current_unit_qty + ?,
          updated_by = ?
      WHERE id = ?
      AND IFNULL(deleted, 0) = 0
      `,
      [Number(movement.quantity || 0), req.user.id, movement.stock_id]
    );

    await conn.query('DELETE FROM stock_movements WHERE id = ?', [movementId]);

    await conn.commit();
    res.json({ message: 'Stock out entry deleted and quantity restored' });
  } catch (error) {
    await conn.rollback();
    console.error('deleteStockMovement error:', error);
    res.status(500).json({ message: 'Failed to delete stock out entry', error: error.message });
  } finally {
    conn.release();
  }
};

exports.getStockMovements = async (req, res) => {
  try {
    await ensureStockTable();

    const [rows] = await pool.query(
      `
      SELECT
        m.*,
        s.product_name,
        s.category,
        s.batch_code,
        u.name AS created_by_name
      FROM stock_movements m
      LEFT JOIN stock_batches s ON s.id = m.stock_id
      LEFT JOIN users u ON u.id = m.created_by
      ORDER BY m.created_at DESC, m.id DESC
      `
    );

    res.json({ movements: rows });
  } catch (error) {
    console.error('getStockMovements error:', error);
    res.status(500).json({ message: 'Failed to load stock usage', error: error.message });
  }
};

exports.deleteStock = async (req, res) => {
  try {
    await ensureStockTable();

    const id = Number(req.body.id);

    if (!id) {
      return res.status(400).json({ message: 'Stock ID is required' });
    }

    const [result] = await pool.query(
      'UPDATE stock_batches SET deleted = 1, updated_by = ? WHERE id = ?',
      [req.user.id, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Stock batch not found' });
    }

    res.json({ message: 'Stock batch deleted successfully' });
  } catch (error) {
    console.error('deleteStock error:', error);
    res.status(500).json({ message: 'Failed to delete stock', error: error.message });
  }
};
