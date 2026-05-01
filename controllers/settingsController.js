const pool = require('../config/db');

exports.getSettings = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT setting_key, setting_value FROM app_settings');

    const settings = {};
    rows.forEach(row => {
      settings[row.setting_key] = row.setting_value;
    });

    res.json({ settings });
  } catch (error) {
    console.error('getSettings error:', error);
    res.status(500).json({ message: 'Failed to load settings', error: error.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const settings = req.body;

    for (const key of Object.keys(settings)) {
      await pool.query(
        `INSERT INTO app_settings (setting_key, setting_value)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, settings[key]]
      );
    }

    res.json({ message: 'Settings saved successfully' });
  } catch (error) {
    console.error('updateSettings error:', error);
    res.status(500).json({ message: 'Failed to save settings', error: error.message });
  }
};