const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();
const PORT = 5000;

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// SQLite setup
const dbPath = path.join(__dirname, 'db', 'stock.db');
const db = new sqlite3.Database(dbPath);

// Ensure the table exists
db.run(`
  CREATE TABLE IF NOT EXISTS stock (
    product TEXT PRIMARY KEY,
    amount REAL
  )
`);

// Get current stock
app.get('/api/stock', (req, res) => {
  db.all('SELECT * FROM stock', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Add stock (increase inventory)
app.post('/api/add', (req, res) => {
  const { product, amount } = req.body;
  db.run(
    `
    INSERT INTO stock (product, amount)
    VALUES (?, ?)
    ON CONFLICT(product) DO UPDATE SET amount = amount + excluded.amount
    `,
    [product, amount],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

// Use stock (decrease inventory)
app.post('/api/used', (req, res) => {
  const { product, amount } = req.body;
  db.run(
    `UPDATE stock SET amount = amount - ? WHERE product = ? AND amount >= ?`,
    [amount, product, amount],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) {
        return res.status(400).json({ error: 'Insufficient stock or product not found' });
      }
      res.json({ success: true });
    }
  );
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
