const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs');

const app = express();
const PORT = 5000;

// Create DB dir if missing
if (!fs.existsSync('./db')) fs.mkdirSync('./db');

// Connect to SQLite db
const db = new sqlite3.Database('./db/stock.db', (err) => {
  if (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
});

// Create tables
const setupDB = () => {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS Product (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      product_type TEXT,
      is_organic INTEGER,
      cost_price REAL,
      supplier TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS Delivery (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER,
      delivery_date TEXT,
      delivery_amount INTEGER,
      FOREIGN KEY (product_id) REFERENCES Product(id)
    )`);
  });
};

setupDB();

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Get all products with current stock 
app.get('/api/stock', (req, res) => {
  const sql = `
    SELECT 
      P.id,
      P.name AS product,
      P.product_type AS type,
      P.supplier,
      P.cost_price,
      P.is_organic,
      COALESCE(SUM(D.delivery_amount), 0) AS current_stock,
      MAX(D.delivery_date) AS last_delivery_date
    FROM Product P
    LEFT JOIN Delivery D ON P.id = D.product_id
    GROUP BY P.id
    ORDER BY P.name
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Error fetching stock:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Add new product 
app.post('/api/add', (req, res) => {
  const { product, product_type, is_organic, cost_price, supplier, delivery_date, delivery_amount } = req.body;

  if (!product || !product_type || is_organic === undefined || !cost_price || !supplier || !delivery_date || !delivery_amount) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  // Insert or ignore product
  db.run(
    `INSERT OR IGNORE INTO Product (name, product_type, is_organic, cost_price, supplier) VALUES (?, ?, ?, ?, ?)`,
    [product, product_type, is_organic, cost_price, supplier],
    function (err) {
      if (err) return res.status(500).json({ error: 'Failed to insert product' });

      // Get product id 
      const getProductId = (callback) => {
        if (this.lastID) return callback(this.lastID);

        db.get(`SELECT id FROM Product WHERE name = ?`, [product], (err, row) => {
          if (err) return res.status(500).json({ error: 'Failed to get product ID' });
          callback(row.id);
        });
      };

      getProductId((productId) => {
        // Insert delivery
        db.run(
          `INSERT INTO Delivery (product_id, delivery_date, delivery_amount) VALUES (?, ?, ?)`,
          [productId, delivery_date, delivery_amount],
          (err) => {
            if (err) return res.status(500).json({ error: 'Failed to insert delivery' });
            res.json({ message: 'Delivery added successfully' });
          }
        );
      });
    }
  );
});

// Subtract stock by adding negative delivery_amount
app.post('/api/used', (req, res) => {
  const { product, amount, delivery_date } = req.body;

  if (!product || !amount) {
    return res.status(400).json({ error: 'Missing product or amount' });
  }

  db.get(`SELECT id FROM Product WHERE name = ?`, [product], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'Product not found' });

    const productId = row.id;
    const date = delivery_date || new Date().toISOString().split('T')[0];

    db.run(
      `INSERT INTO Delivery (product_id, delivery_date, delivery_amount) VALUES (?, ?, ?)`,
      [productId, date, -Math.abs(amount)],
      (err) => {
        if (err) return res.status(500).json({ error: 'Failed to record usage' });
        res.json({ message: 'Stock usage recorded' });
      }
    );
  });
});

// Get product list for form dropdown
app.get('/api/products', (req, res) => {
  db.all(`SELECT name AS product FROM Product ORDER BY name`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch products' });
    res.json(rows);
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
